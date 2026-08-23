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
    krokiFetch(request: Request): Promise<Response>;
    krokiOrigin?: string;
    mcpFetch?: (sessionId: string, request: Request, cell: SessionObjectStub) => Promise<Response>;
}

const SESSION_ID = /^[0-9a-f]{64}$/i;

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
    status,
    headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    },
});

const forwardedRequest = async (request: Request, target: URL): Promise<Request> => {
    const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();
    return new Request(target, {
        method: request.method,
        headers: request.headers,
        body,
        redirect: request.redirect,
    });
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
} => ({
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/config.json' && request.method === 'GET') {
            return json({
                renderServerUrl: `${url.origin}/render/`,
                sessionBackendUrl: url.origin,
            });
        }

        if (url.pathname === '/api/sessions' && request.method === 'POST') {
            const id = dependencies.namespace.newUniqueId();
            const idText = id.toString();
            const cell = dependencies.namespace.get(id);
            const initializeUrl = new URL('/initialize', url.origin);
            const initialized = await cell.fetch(await forwardedRequest(request, initializeUrl));
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

        const apiMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(state|mutate|crdt|undo|close|snapshot|connect|view\/[^/]+|renderer-options\/[^/]+))?$/);
        if (apiMatch) {
            const cell = sessionStub(dependencies.namespace, apiMatch[1]);
            if (!cell) return json({ error: 'Session not found' }, 404);
            const action = apiMatch[2] || 'state';
            return cell.fetch(await forwardedRequest(request, new URL(`/${action}`, url.origin)));
        }

        const mcpMatch = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
        if (mcpMatch) {
            const cell = sessionStub(dependencies.namespace, mcpMatch[1]);
            if (!cell) return json({ error: 'Session not found' }, 404);
            if (!dependencies.mcpFetch) return json({ error: 'MCP is unavailable' }, 503);
            return dependencies.mcpFetch(mcpMatch[1], request, cell);
        }

        if (url.pathname.startsWith('/render/')) {
            const target = new URL(url.pathname.slice('/render/'.length), dependencies.krokiOrigin || 'http://kroki:8000/');
            target.search = url.search;
            return dependencies.krokiFetch(await forwardedRequest(request, target));
        }

        const sessionPage = url.pathname.match(/^\/s\/([^/]+)\/?$/);
        if (sessionPage) {
            if (!SESSION_ID.test(sessionPage[1])) return json({ error: 'Session not found' }, 404);
            return dependencies.assetFetch(await forwardedRequest(request, new URL('/', url.origin)));
        }

        return dependencies.assetFetch(request);
    },
});
