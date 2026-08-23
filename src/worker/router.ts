import { limitRequestBody, RequestBodyTooLargeError } from './requestLimits';
import { readResponseBytes, RemoteResponseTooLargeError, withRenderDeadline } from '../rendering/remote';

export interface SessionObjectId {
    toString(): string;
}

export interface SessionObjectStub {
    fetch(request: Request): Promise<Response>;
}

export interface SessionNamespace {
    newUniqueId(): SessionObjectId;
    idFromString(value: string): SessionObjectId;
    get(id: SessionObjectId): SessionObjectStub;
}

export interface WorkerRouterDependencies {
    namespace: SessionNamespace;
    assetFetch(request: Request): Promise<Response>;
    krokiFetch(request: Request, init?: RequestInit): Promise<Response>;
    krokiOrigin?: string;
    mcpFetch?: (sessionId: string, request: Request, cell: SessionObjectStub) => Promise<Response>;
    limits?: {
        now?: () => number;
        maxSessionCreationsPerMinute?: number;
        maxProxyRendersPerMinute?: number;
        maxConcurrentProxyRenders?: number;
        maxRequestBodyBytes?: number;
        maxProxyRenderMs?: number;
        maxProxyResponseBytes?: number;
    };
}

const SESSION_ID = /^[0-9a-f]{64}$/i;
const KROKI_PATH = /^[a-z0-9_-]+\/[a-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/i;

const json = (value: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(value), {
    status,
    headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...headers,
    },
});

const forwardedRequest = async (request: Request, target: URL, maxBodyBytes: number): Promise<Request> => {
    const bounded = await limitRequestBody(request, maxBodyBytes);
    const body = bounded.method === 'GET' || bounded.method === 'HEAD'
        ? undefined
        : await bounded.arrayBuffer();
    return new Request(target, {
        method: bounded.method,
        headers: bounded.headers,
        body,
        redirect: bounded.redirect,
    });
};

const combineSignals = (signals: AbortSignal[]): { signal: AbortSignal; dispose(): void } => {
    const controller = new AbortController();
    const listeners = signals.map((signal) => {
        const abort = () => {
            if (!controller.signal.aborted) controller.abort(signal.reason);
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        return { signal, abort };
    });
    return {
        signal: controller.signal,
        dispose: () => listeners.forEach(({ signal, abort }) => signal.removeEventListener('abort', abort)),
    };
};

const sessionStub = (
    namespace: SessionNamespace,
    id: string,
): SessionObjectStub | null => {
    if (!SESSION_ID.test(id)) return null;
    try {
        return namespace.get(namespace.idFromString(id));
    } catch {
        return null;
    }
};

export const createWorkerRouter = (dependencies: WorkerRouterDependencies): {
    fetch(request: Request): Promise<Response>;
} => {
    const now = dependencies.limits?.now || Date.now;
    const maxSessionCreationsPerMinute = dependencies.limits?.maxSessionCreationsPerMinute ?? 10;
    const maxProxyRendersPerMinute = dependencies.limits?.maxProxyRendersPerMinute ?? 120;
    const maxConcurrentProxyRenders = dependencies.limits?.maxConcurrentProxyRenders ?? 8;
    const maxRequestBodyBytes = dependencies.limits?.maxRequestBodyBytes ?? 512 * 1024;
    const maxProxyRenderMs = dependencies.limits?.maxProxyRenderMs ?? 30_000;
    const maxProxyResponseBytes = dependencies.limits?.maxProxyResponseBytes ?? 8 * 1024 * 1024;
    const maxRateLimitClients = 4_096;
    const attempts = new Map<string, number[]>();
    let proxyRendersInFlight = 0;
    const clientId = (request: Request): string => request.headers.get('cf-connecting-ip')
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
    const accept = (operation: 'create' | 'render', request: Request): boolean => {
        const key = `${operation}:${clientId(request)}`;
        const cutoff = now() - 60_000;
        if (!attempts.has(key) && attempts.size >= maxRateLimitClients) {
            for (const [candidate, timestamps] of attempts) {
                if (timestamps.every((at) => at <= cutoff)) attempts.delete(candidate);
            }
            if (attempts.size >= maxRateLimitClients) {
                const oldest = attempts.keys().next().value as string | undefined;
                if (oldest) attempts.delete(oldest);
            }
        }
        const recent = (attempts.get(key) || []).filter((at) => at > cutoff);
        const limit = operation === 'create' ? maxSessionCreationsPerMinute : maxProxyRendersPerMinute;
        if (recent.length >= limit) {
            attempts.set(key, recent);
            return false;
        }
        recent.push(now());
        attempts.set(key, recent);
        return true;
    };

    return {
        async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);
            try {
                if (url.pathname === '/config.json' && request.method === 'GET') {
                    return json({
                        renderServerUrl: `${url.origin}/render/`,
                        sessionBackendUrl: url.origin,
                    });
                }

                if (url.pathname === '/api/sessions' && request.method === 'POST') {
                    const initializeUrl = new URL('/initialize', url.origin);
                    const initializeRequest = await forwardedRequest(request, initializeUrl, maxRequestBodyBytes);
                    if (!accept('create', request)) {
                        return json({ error: 'Session creation rate limit exceeded' }, 429, { 'retry-after': '60' });
                    }
                    const id = dependencies.namespace.newUniqueId();
                    const idText = id.toString();
                    const cell = dependencies.namespace.get(id);
                    const initialized = await cell.fetch(initializeRequest);
                    if (!initialized.ok) return initialized;

                    const websocketUrl = new URL(`/api/sessions/${idText}/connect`, url.origin);
                    websocketUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
                    return json({
                        id: idText,
                        sessionUrl: `${url.origin}/s/${idText}`,
                        websocketUrl: websocketUrl.href,
                        mcpUrl: `${url.origin}/mcp/${idText}`,
                    }, 201);
                }

                const apiMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(state|presence|mutate|crdt|undo|close|snapshot|connect|render|export|view\/[^/]+|renderer-options\/[^/]+))?$/);
                if (apiMatch) {
                    const cell = sessionStub(dependencies.namespace, apiMatch[1]);
                    if (!cell) return json({ error: 'Session not found' }, 404);
                    const action = apiMatch[2] || 'state';
                    return cell.fetch(await forwardedRequest(
                        request,
                        new URL(`/${action}`, url.origin),
                        maxRequestBodyBytes,
                    ));
                }

                const mcpMatch = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
                if (mcpMatch) {
                    const cell = sessionStub(dependencies.namespace, mcpMatch[1]);
                    if (!cell) return json({ error: 'Session not found' }, 404);
                    if (!dependencies.mcpFetch) return json({ error: 'MCP is unavailable' }, 503);
                    return dependencies.mcpFetch(mcpMatch[1], request, cell);
                }

                if (url.pathname.startsWith('/render/')) {
                    const renderPath = url.pathname.slice('/render/'.length);
                    if (!KROKI_PATH.test(renderPath)) return json({ error: 'Invalid render path' }, 400);
                    const origin = new URL(dependencies.krokiOrigin || 'http://kroki:8000/');
                    const target = new URL(renderPath, origin);
                    if (target.origin !== origin.origin) return json({ error: 'Invalid render path' }, 400);
                    target.search = url.search;
                    const krokiRequest = await forwardedRequest(request, target, maxRequestBodyBytes);
                    if (!accept('render', request)) {
                        return json({ error: 'Render proxy rate limit exceeded' }, 429, { 'retry-after': '60' });
                    }
                    if (proxyRendersInFlight >= maxConcurrentProxyRenders) {
                        return json({ error: 'Too many concurrent proxy renders' }, 429, { 'retry-after': '1' });
                    }
                    proxyRendersInFlight += 1;
                    try {
                        return await withRenderDeadline(maxProxyRenderMs, async (deadlineSignal) => {
                            const combined = combineSignals([request.signal, deadlineSignal]);
                            try {
                                const upstream = await dependencies.krokiFetch(krokiRequest, { signal: combined.signal });
                                const bytes = await readResponseBytes(upstream, maxProxyResponseBytes);
                                const headers = new Headers(upstream.headers);
                                headers.delete('content-encoding');
                                headers.delete('transfer-encoding');
                                headers.set('content-length', String(bytes.byteLength));
                                return new Response(Uint8Array.from(bytes), {
                                    status: upstream.status,
                                    statusText: upstream.statusText,
                                    headers,
                                });
                            } finally {
                                combined.dispose();
                            }
                        });
                    } finally {
                        proxyRendersInFlight -= 1;
                    }
                }

                const sessionPage = url.pathname.match(/^\/s\/([^/]+)\/?$/);
                if (sessionPage) {
                    if (!SESSION_ID.test(sessionPage[1])) return json({ error: 'Session not found' }, 404);
                    return dependencies.assetFetch(await forwardedRequest(
                        request,
                        new URL('/', url.origin),
                        maxRequestBodyBytes,
                    ));
                }

                return dependencies.assetFetch(request);
            } catch (error) {
                if (error instanceof RequestBodyTooLargeError) return json({ error: error.message }, 413);
                if (error instanceof RemoteResponseTooLargeError) return json({ error: error.message }, 502);
                if (error instanceof Error && error.message === `Render server timed out after ${maxProxyRenderMs}ms`) {
                    return json({ error: error.message }, 504);
                }
                throw error;
            }
        },
    };
};
