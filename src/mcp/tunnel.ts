/**
 * Tunnel client that connects the browser-side MCP server to the
 * Cloudflare Worker relay via a SharedWorker.
 *
 * The SharedWorker holds the WebSocket connection and keepalive timers,
 * which are immune to browser background-tab throttling. MCP requests
 * are forwarded from the SharedWorker to this client via MessagePort,
 * processed by the McpServer on the main thread (which has React state
 * access), and responses sent back through the same channel.
 *
 * If SharedWorker is unavailable, falls back to a main-thread WebSocket.
 */

import type { McpServer } from './server';

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface TunnelState {
    status: TunnelStatus;
    sessionId: string | null;
    sseUrl: string | null;
    error: string | null;
}

interface TunnelCallbacks {
    onStateChange: (state: TunnelState) => void;
}

// --- SharedWorker-based tunnel ---

class SharedWorkerTunnel {
    private worker: SharedWorker;
    private server: McpServer;
    private callbacks: TunnelCallbacks;
    private state: TunnelState = {
        status: 'disconnected',
        sessionId: null,
        sseUrl: null,
        error: null,
    };

    constructor(server: McpServer, callbacks: TunnelCallbacks) {
        this.server = server;
        this.callbacks = callbacks;

        this.worker = new SharedWorker(
            new URL('./tunnel-worker.ts', import.meta.url),
            { type: 'module', name: 'neolesk-mcp-tunnel' },
        );

        this.worker.port.onmessage = (event: MessageEvent) => {
            const data = event.data;

            if (data.type === 'state') {
                this.state = data.state;
                this.callbacks.onStateChange(this.state);
            } else if (data.type === 'mcp_request') {
                this.handleMcpRequest(data.clientId, data.body);
            }
        };

        this.worker.port.start();
    }

    private async handleMcpRequest(clientId: string, body: string): Promise<void> {
        try {
            const response = await this.server.handleMessage(body);
            if (response) {
                this.worker.port.postMessage({
                    type: 'mcp_response',
                    clientId,
                    body: response,
                });
            }
        } catch (err) {
            console.error('[McpTunnel] Error handling MCP request:', err);
        }
    }

    connect(relayBaseUrl: string): void {
        this.worker.port.postMessage({
            type: 'connect',
            relayBaseUrl,
        });
    }

    disconnect(): void {
        this.worker.port.postMessage({ type: 'disconnect' });
    }

    getState(): TunnelState {
        return this.state;
    }
}

// --- Main-thread fallback tunnel (for browsers without SharedWorker) ---

const KEEPALIVE_INTERVAL_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;

class MainThreadTunnel {
    private server: McpServer;
    private callbacks: TunnelCallbacks;
    private ws: WebSocket | null = null;
    private relayBaseUrl: string | null = null;
    private state: TunnelState = {
        status: 'disconnected',
        sessionId: null,
        sseUrl: null,
        error: null,
    };
    private intentionalDisconnect = false;
    private reconnectAttempts = 0;
    private reconnectTimer: number | null = null;
    private keepaliveTimer: number | null = null;
    private visibilityHandler: (() => void) | null = null;

    constructor(server: McpServer, callbacks: TunnelCallbacks) {
        this.server = server;
        this.callbacks = callbacks;
    }

    private updateState(patch: Partial<TunnelState>): void {
        this.state = { ...this.state, ...patch };
        this.callbacks.onStateChange(this.state);
    }

    connect(relayBaseUrl: string): void {
        if (this.ws) this.disconnect();
        this.relayBaseUrl = relayBaseUrl.replace(/\/+$/, '');
        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        this.doConnect();
    }

    private async doConnect(): Promise<void> {
        if (!this.relayBaseUrl) return;
        const isReconnect = this.reconnectAttempts > 0;
        this.updateState({ status: isReconnect ? 'reconnecting' : 'connecting', error: null });

        try {
            const sessionRes = await fetch(`${this.relayBaseUrl}/session`, { method: 'POST' });
            if (!sessionRes.ok) throw new Error(`Failed to create session: HTTP ${sessionRes.status}`);
            const { sessionId } = await sessionRes.json() as { sessionId: string };

            const wsUrl = `${this.relayBaseUrl.replace(/^http/, 'ws')}/s/${sessionId}/ws`;
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                this.reconnectAttempts = 0;
                const sseUrl = `${this.relayBaseUrl}/s/${sessionId}/sse`;
                this.updateState({ status: 'connected', sessionId, sseUrl, error: null });
                this.startKeepalive();
            };

            ws.onmessage = async (event) => {
                try {
                    const envelope = JSON.parse(event.data) as { type: string; clientId: string; body: string };
                    if (envelope.type === 'mcp_request') {
                        const response = await this.server.handleMessage(envelope.body);
                        if (response) {
                            ws.send(JSON.stringify({ type: 'mcp_response', clientId: envelope.clientId, body: response }));
                        }
                    }
                } catch (err) {
                    console.error('[McpTunnel] Error handling message:', err);
                }
            };

            ws.onclose = () => {
                this.ws = null;
                this.stopKeepalive();
                if (!this.intentionalDisconnect && this.state.status === 'connected') {
                    this.scheduleReconnect();
                } else if (!this.intentionalDisconnect) {
                    this.updateState({ status: 'disconnected', sessionId: null, sseUrl: null });
                }
            };

            ws.onerror = () => {
                if (this.reconnectAttempts === 0) this.updateState({ error: 'WebSocket connection failed' });
            };

            this.ws = ws;
        } catch (err) {
            if (!this.intentionalDisconnect) {
                this.scheduleReconnect(err instanceof Error ? err.message : 'Connection failed');
            }
        }
    }

    private scheduleReconnect(errorMsg?: string): void {
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.updateState({ status: 'error', error: errorMsg || `Disconnected after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`, sessionId: null, sseUrl: null });
            return;
        }
        this.reconnectAttempts++;
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
        this.updateState({ status: 'reconnecting', error: `Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, sessionId: null, sseUrl: null });
        this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.doConnect(); }, delay);
    }

    private startKeepalive(): void {
        this.stopKeepalive();
        this.keepaliveTimer = window.setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, KEEPALIVE_INTERVAL_MS);
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible' && this.ws) {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                } else if (this.ws.readyState === WebSocket.CLOSED) {
                    this.ws = null;
                    this.stopKeepalive();
                    this.scheduleReconnect();
                }
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private stopKeepalive(): void {
        if (this.keepaliveTimer !== null) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
        if (this.visibilityHandler) { document.removeEventListener('visibilitychange', this.visibilityHandler); this.visibilityHandler = null; }
    }

    disconnect(): void {
        this.intentionalDisconnect = true;
        if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this.stopKeepalive();
        if (this.ws) { this.ws.onclose = null; this.ws.onerror = null; this.ws.close(); this.ws = null; }
        this.updateState({ status: 'disconnected', sessionId: null, sseUrl: null, error: null });
    }

    getState(): TunnelState {
        return this.state;
    }
}

// --- Public API ---

export interface McpTunnelHandle {
    connect(relayBaseUrl: string): void;
    disconnect(): void;
    getState(): TunnelState;
}

const supportsSharedWorker = typeof SharedWorker !== 'undefined';

export function createTunnel(server: McpServer, callbacks: TunnelCallbacks): McpTunnelHandle {
    if (supportsSharedWorker) {
        return new SharedWorkerTunnel(server, callbacks);
    }
    return new MainThreadTunnel(server, callbacks);
}
