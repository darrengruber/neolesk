import { createKrokiRemoteAdapter } from '../rendering/remote';
import { workerRendererCatalog } from '../rendering/catalog';
import { createRenderingModule } from '../rendering/rendering';
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

const responseJson = async <T>(response: Response): Promise<T> => {
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    return response.json() as Promise<T>;
};

export class SessionCell {
    private readonly core: ReturnType<typeof createSessionCell>;

    constructor(private readonly state: ObjectState, _environment: WorkerEnvironment) {
        this.core = createSessionCell(state.storage, {
            idleTtlMs: SESSION_IDLE_TTL_MS,
            onChange: (change) => { void this.broadcastSnapshot(change); },
        });
    }

    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/connect') return this.connect(request);
        return this.core.fetch(request);
    }

    async alarm(): Promise<void> {
        if (this.state.getWebSockets().length > 0) {
            await this.state.storage.setAlarm(Date.now() + SESSION_IDLE_TTL_MS);
            return;
        }
        await this.core.expire();
    }

    async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
        try {
            const parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as Record<string, unknown>;
            if (parsed.type === 'loro-update' && typeof parsed.update === 'string') {
                const response = await this.core.fetch(new Request('https://session.internal/crdt', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        update: parsed.update,
                        actor: parsed.actor === 'agent' ? 'agent' : 'human',
                        actorId: typeof parsed.actorId === 'string' ? parsed.actorId : 'browser',
                    }),
                }));
                if (!response.ok) socket.send(JSON.stringify({ type: 'error', message: await response.text() }));
                return;
            }
            if (parsed.type === 'presence') this.broadcast(JSON.stringify(parsed));
        } catch (error) {
            socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }));
        }
    }

    async webSocketClose(_socket: WebSocket): Promise<void> {
        this.broadcast(JSON.stringify({ type: 'presence', state: 'disconnected' }));
        await this.state.storage.setAlarm(Date.now() + SESSION_IDLE_TTL_MS);
    }

    private async connect(request: Request): Promise<Response> {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        }
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        this.state.acceptWebSocket(server);
        await this.state.storage.deleteAlarm?.();

        const state = await responseJson<Record<string, unknown>>(await this.core.fetch(new Request('https://session.internal/state')));
        const snapshotResponse = await this.core.fetch(new Request('https://session.internal/snapshot'));
        const snapshot = new Uint8Array(await snapshotResponse.arrayBuffer());
        server.send(JSON.stringify({ type: 'snapshot', update: bytesToBase64(snapshot), state }));
        this.broadcast(JSON.stringify({ type: 'presence', state: 'connected' }));

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
        const workerRendering = createRenderingModule({
            catalog: workerRendererCatalog,
            environment: 'worker',
            remoteRender: createKrokiRemoteAdapter(),
        });
        const router = createWorkerRouter({
            namespace: environment.SESSION_CELL,
            assetFetch: (assetRequest) => environment.ASSETS.fetch(assetRequest),
            krokiFetch: (krokiRequest) => fetch(krokiRequest),
            krokiOrigin,
            mcpFetch: async (sessionId, mcpRequest, cell) => {
                const handler = createSessionMcpHandler({
                    sessionId,
                    cell,
                    snapshotBaseUrl: new URL('/', mcpRequest.url).href,
                    render: ({ language, source, format, options }) => workerRendering.render({
                        language,
                        source,
                        format,
                        options,
                        remote: { id: 'neolesk-kroki', label: 'neolesk Kroki', url: krokiOrigin },
                    }),
                    exportBinary: async ({ language, source, format }) => {
                        const response = await fetch(new URL(`${language}/${format}`, krokiOrigin), {
                            method: 'POST',
                            headers: { 'content-type': 'text/plain; charset=utf-8' },
                            body: source,
                        });
                        if (!response.ok) throw new Error((await response.text()) || `Kroki returned HTTP ${response.status}`);
                        return {
                            data: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
                            mimeType: response.headers.get('content-type') || `image/${format}`,
                        };
                    },
                });
                return handler.fetch(mcpRequest);
            },
        });
        return router.fetch(request);
    },
};
