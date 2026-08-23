import {
    createKrokiEndpoint,
    createKrokiRemoteAdapter,
    createKrokiRemoteRenderer,
    readResponseBytes,
    withRenderDeadline,
} from '../rendering/remote';
import { workerRendererCatalog } from '../rendering/workerCatalog';
import { createRenderingModule, validateRendererOptions } from '../rendering/rendering';
import { bytesToBase64 } from '../session/base64';
import { createSessionCell, type SessionCellStorage } from '../session/sessionCell';
import { createWorkerRouter, type SessionNamespace } from './router';
import { createSessionMcpHandler } from './sessionMcp';

interface AssetBinding {
    fetch(request: Request): Promise<Response>;
}

interface WorkerEnvironment {
    ASSETS: AssetBinding;
    SESSION_CELL: SessionNamespace;
    KROKI_ORIGIN?: string;
}

interface ObjectState {
    storage: SessionCellStorage & {
        deleteAlarm?(): Promise<void>;
    };
    acceptWebSocket(socket: WebSocket): void;
    getWebSockets(): WebSocket[];
}

declare const WebSocketPair: {
    new(): { 0: WebSocket; 1: WebSocket };
};

const DEFAULT_KROKI_ORIGIN = 'http://kroki-main.kroki.svc.cluster.local:8080/';
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_WEBSOCKETS = 32;
const MAX_WEBSOCKET_FRAME_BYTES = 512 * 1024;
const MAX_PRESENCE_MESSAGES_PER_MINUTE = 10;
const MAX_WEBSOCKET_MESSAGES_PER_MINUTE = 240;
const MAX_PROTOCOL_VIOLATIONS = 3;
const MAX_BINARY_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_MCP_EXPORT_BYTES = 4 * 1024 * 1024;
const MAX_RENDER_ERROR_BYTES = 64 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const BROWSER_PARTICIPANT_ID = /^browser-[0-9a-f]{16}$/;
let router: ReturnType<typeof createWorkerRouter> | null = null;

class SocketMessageError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'SocketMessageError';
    }
}

const responseJson = async <T>(response: Response): Promise<T> => {
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    return response.json() as Promise<T>;
};

export class SessionCell {
    private readonly core: ReturnType<typeof createSessionCell>;
    private readonly socketParticipants = new WeakMap<WebSocket, string>();
    private readonly socketPresenceAttempts = new WeakMap<WebSocket, number[]>();
    private readonly socketMessageAttempts = new WeakMap<WebSocket, number[]>();
    private readonly socketProtocolViolations = new WeakMap<WebSocket, number>();

    constructor(private readonly state: ObjectState, environment: WorkerEnvironment) {
        const krokiOrigin = environment.KROKI_ORIGIN || DEFAULT_KROKI_ORIGIN;
        const rendering = createRenderingModule({
            catalog: workerRendererCatalog,
            environment: 'worker',
            remoteRender: createKrokiRemoteAdapter(),
        });
        const inClusterRenderer = createKrokiRemoteRenderer({
            id: 'neolesk', label: 'neolesk Kroki', url: krokiOrigin,
        });
        this.core = createSessionCell(state.storage, {
            idleTtlMs: SESSION_IDLE_TTL_MS,
            onChange: (change) => {
                if (change.type === 'changed') void this.broadcastSnapshot(change);
                else {
                    this.broadcast(JSON.stringify(change));
                    if (change.type === 'closed') {
                        this.state.getWebSockets().forEach((socket) => socket.close(1000, 'Session closed'));
                    }
                }
            },
            validateLanguage: (language) => Object.prototype.hasOwnProperty.call(inClusterRenderer.capabilities, language),
            validateRendererOptions: (language, options) => {
                const capability = inClusterRenderer.capabilities[language];
                if (!capability) throw new Error(`Unsupported diagram language ${language}`);
                return validateRendererOptions(capability.optionDefinitions, options);
            },
            render: ({ language, source, format, options }) => rendering.render({
                language,
                source,
                format,
                options,
                remote: inClusterRenderer,
            }),
            maxExportBytes: MAX_BINARY_EXPORT_BYTES,
            exportBinary: async ({ language, source, format, options, rendererId, maxBytes }) => {
                const targetOrigin = rendererId === 'kroki-io' ? 'https://kroki.io/' : krokiOrigin;
                return withRenderDeadline(RENDER_TIMEOUT_MS, async (signal) => {
                    const response = await fetch(createKrokiEndpoint(targetOrigin, language, format, options), {
                        method: 'POST',
                        headers: { 'content-type': 'text/plain; charset=utf-8' },
                        body: source,
                        signal,
                    });
                    const data = await readResponseBytes(
                        response,
                        response.ok ? maxBytes : MAX_RENDER_ERROR_BYTES,
                    );
                    if (!response.ok) {
                        const message = new TextDecoder().decode(data).trim();
                        throw new Error(message || `Kroki returned HTTP ${response.status}`);
                    }
                    return {
                        data,
                        mimeType: response.headers.get('content-type') || `image/${format}`,
                    };
                });
            },
        });
    }

    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/connect') return this.connect(request);
        return this.core.fetch(request);
    }

    async alarm(): Promise<void> {
        await this.core.expire({ keepAlive: this.state.getWebSockets().length > 0 });
    }

    async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
        try {
            if ((typeof message === 'string' && message.length > MAX_WEBSOCKET_FRAME_BYTES)
                || (message instanceof ArrayBuffer && message.byteLength > MAX_WEBSOCKET_FRAME_BYTES)) {
                throw new SocketMessageError(413, 'WebSocket frame is too large');
            }
            const encoded = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message);
            if (encoded.byteLength > MAX_WEBSOCKET_FRAME_BYTES) {
                throw new SocketMessageError(413, 'WebSocket frame is too large');
            }
            const cutoff = Date.now() - 60_000;
            const messages = (this.socketMessageAttempts.get(socket) || []).filter((at) => at > cutoff);
            if (messages.length >= MAX_WEBSOCKET_MESSAGES_PER_MINUTE) {
                throw new SocketMessageError(429, 'WebSocket message rate limit exceeded');
            }
            messages.push(Date.now());
            this.socketMessageAttempts.set(socket, messages);
            const parsed = JSON.parse(new TextDecoder().decode(encoded)) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new SocketMessageError(400, 'Expected a WebSocket message object');
            }
            const input = parsed as Record<string, unknown>;
            if (input.type === 'loro-update' && typeof input.update === 'string') {
                const actorId = this.socketParticipants.get(socket);
                if (!actorId) throw new SocketMessageError(400, 'Presence required before document updates');
                if (input.actorId !== undefined && input.actorId !== actorId) {
                    throw new SocketMessageError(409, 'WebSocket participant identity cannot change');
                }
                const response = await this.core.fetch(new Request('https://session.internal/crdt', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        update: input.update,
                        actorId,
                    }),
                }));
                if (!response.ok) {
                    const retryAfterSeconds = Number(response.headers.get('retry-after'));
                    socket.send(JSON.stringify({
                        type: 'error',
                        status: response.status,
                        message: await response.text(),
                        retryAfterMs: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : undefined,
                    }));
                } else {
                    socket.send(JSON.stringify({ type: 'ack' }));
                }
                return;
            }
            if (input.type === 'presence') {
                const cutoff = Date.now() - 60_000;
                const attempts = (this.socketPresenceAttempts.get(socket) || []).filter((at) => at > cutoff);
                if (attempts.length >= MAX_PRESENCE_MESSAGES_PER_MINUTE) {
                    throw new SocketMessageError(429, 'WebSocket presence rate limit exceeded');
                }
                attempts.push(Date.now());
                this.socketPresenceAttempts.set(socket, attempts);
                const actorId = typeof input.actorId === 'string' ? input.actorId : '';
                if (!BROWSER_PARTICIPANT_ID.test(actorId)) {
                    throw new SocketMessageError(400, 'Invalid browser participant identity');
                }
                const bound = this.socketParticipants.get(socket);
                if (bound && bound !== actorId) {
                    throw new SocketMessageError(409, 'WebSocket participant identity cannot change');
                }
                const state = input.state === 'disconnected' ? 'disconnected' : input.state === 'connected' ? 'connected' : null;
                if (!state) throw new SocketMessageError(400, 'Invalid presence state');
                if (!bound && state === 'disconnected') throw new SocketMessageError(400, 'Presence is not connected');
                if (state === 'connected') this.socketParticipants.set(socket, actorId);
                const response = await this.core.fetch(new Request('https://session.internal/presence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ state, actor: 'human', actorId }),
                }));
                if (!response.ok) throw new SocketMessageError(response.status, await response.text());
                if (state === 'disconnected') this.socketParticipants.delete(socket);
                return;
            }
            throw new SocketMessageError(400, 'Unsupported WebSocket message type');
        } catch (error) {
            const status = error instanceof SocketMessageError ? error.status : 400;
            socket.send(JSON.stringify({
                type: 'error',
                status,
                message: error instanceof Error ? error.message : String(error),
            }));
            const violations = (this.socketProtocolViolations.get(socket) || 0) + 1;
            this.socketProtocolViolations.set(socket, violations);
            if (status === 413) socket.close(1009, 'WebSocket frame is too large');
            else if (status === 429 || violations >= MAX_PROTOCOL_VIOLATIONS) {
                socket.close(1008, 'WebSocket protocol limit exceeded');
            }
        }
    }

    async webSocketClose(socket: WebSocket): Promise<void> {
        const actorId = this.socketParticipants.get(socket);
        if (!actorId) return;
        this.socketParticipants.delete(socket);
        await this.core.fetch(new Request('https://session.internal/presence', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state: 'disconnected', actor: 'human', actorId }),
        }));
    }

    private async connect(request: Request): Promise<Response> {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        }
        if (this.state.getWebSockets().length >= MAX_SESSION_WEBSOCKETS) {
            return new Response(JSON.stringify({ error: 'Session WebSocket limit exceeded' }), {
                status: 429,
                headers: { 'content-type': 'application/json', 'retry-after': '60' },
            });
        }
        const stateResponse = await this.core.fetch(new Request('https://session.internal/state'));
        if (!stateResponse.ok) return stateResponse;
        const state = await responseJson<Record<string, unknown>>(stateResponse);
        const snapshotResponse = await this.core.fetch(new Request('https://session.internal/snapshot'));
        if (!snapshotResponse.ok) return snapshotResponse;
        const snapshot = new Uint8Array(await snapshotResponse.arrayBuffer());
        const agentPresence = await responseJson<Record<string, unknown>>(
            await this.core.fetch(new Request('https://session.internal/presence')),
        );

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        this.state.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'snapshot', update: bytesToBase64(snapshot), state }));
        server.send(JSON.stringify(agentPresence));

        return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }

    private broadcast(message: string): void {
        this.state.getWebSockets().forEach((socket) => {
            try { socket.send(message); } catch { /* disconnected sockets are pruned by the runtime */ }
        });
    }

    private async broadcastSnapshot(change: object): Promise<void> {
        const response = await this.core.fetch(new Request('https://session.internal/snapshot'));
        if (!response.ok) return;
        const snapshot = new Uint8Array(await response.arrayBuffer());
        this.broadcast(JSON.stringify({ ...change, type: 'snapshot', update: bytesToBase64(snapshot) }));
    }
}

export default {
    async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
        const krokiOrigin = environment.KROKI_ORIGIN || DEFAULT_KROKI_ORIGIN;
        router ||= createWorkerRouter({
            namespace: environment.SESSION_CELL,
            assetFetch: (assetRequest) => environment.ASSETS.fetch(assetRequest),
            krokiFetch: (krokiRequest, init) => fetch(krokiRequest, init),
            krokiOrigin,
            mcpFetch: async (sessionId, mcpRequest, cell) => {
                const handler = createSessionMcpHandler({
                    sessionId,
                    cell,
                    snapshotBaseUrl: new URL('/', mcpRequest.url).href,
                    maxExportBytes: MAX_MCP_EXPORT_BYTES,
                });
                return handler.fetch(mcpRequest);
            },
        });
        return router.fetch(request);
    },
};
