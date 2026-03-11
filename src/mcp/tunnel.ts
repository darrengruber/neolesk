/**
 * WebSocket tunnel client that connects the browser-side MCP server
 * to the Cloudflare Worker relay.
 *
 * Flow:
 * 1. POST /session to get a session ID
 * 2. Connect WebSocket to /s/{sessionId}/ws
 * 3. Relay incoming MCP requests to the McpServer, send responses back
 *
 * Reliability features:
 * - Automatic reconnection with exponential backoff on unexpected drops
 * - Keepalive pings to prevent idle timeouts (especially in background tabs)
 * - Visibility-aware: sends pings more aggressively when tab is hidden
 *   since browsers throttle background tab timers
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

const KEEPALIVE_INTERVAL_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;

export class McpTunnel {
    private relayBaseUrl: string;
    private server: McpServer;
    private callbacks: TunnelCallbacks;
    private ws: WebSocket | null = null;
    private state: TunnelState = {
        status: 'disconnected',
        sessionId: null,
        sseUrl: null,
        error: null,
    };

    // Reconnection state
    private intentionalDisconnect = false;
    private reconnectAttempts = 0;
    private reconnectTimer: number | null = null;
    private lastRelayUrl: string | null = null;

    // Keepalive state
    private keepaliveTimer: number | null = null;
    private visibilityHandler: (() => void) | null = null;

    constructor(relayBaseUrl: string, server: McpServer, callbacks: TunnelCallbacks) {
        this.relayBaseUrl = relayBaseUrl.replace(/\/+$/, '');
        this.server = server;
        this.callbacks = callbacks;
    }

    private updateState(patch: Partial<TunnelState>): void {
        this.state = { ...this.state, ...patch };
        this.callbacks.onStateChange(this.state);
    }

    async connect(): Promise<void> {
        if (this.ws) {
            this.disconnect();
        }

        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        this.lastRelayUrl = this.relayBaseUrl;
        await this.doConnect();
    }

    private async doConnect(): Promise<void> {
        const isReconnect = this.reconnectAttempts > 0;
        this.updateState({
            status: isReconnect ? 'reconnecting' : 'connecting',
            error: null,
        });

        try {
            // Step 1: Create a session
            const sessionRes = await fetch(`${this.relayBaseUrl}/session`, { method: 'POST' });
            if (!sessionRes.ok) {
                throw new Error(`Failed to create session: HTTP ${sessionRes.status}`);
            }
            const { sessionId } = await sessionRes.json() as { sessionId: string };

            // Step 2: Connect WebSocket
            const wsUrl = `${this.relayBaseUrl.replace(/^http/, 'ws')}/s/${sessionId}/ws`;
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                this.reconnectAttempts = 0;
                const sseUrl = `${this.relayBaseUrl}/s/${sessionId}/sse`;
                this.updateState({
                    status: 'connected',
                    sessionId,
                    sseUrl,
                    error: null,
                });
                this.startKeepalive();
            };

            ws.onmessage = async (event) => {
                try {
                    const envelope = JSON.parse(event.data) as {
                        type: string;
                        clientId: string;
                        body: string;
                    };

                    if (envelope.type === 'mcp_request') {
                        const response = await this.server.handleMessage(envelope.body);
                        if (response) {
                            ws.send(JSON.stringify({
                                type: 'mcp_response',
                                clientId: envelope.clientId,
                                body: response,
                            }));
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
                    this.updateState({
                        status: 'disconnected',
                        sessionId: null,
                        sseUrl: null,
                    });
                }
            };

            ws.onerror = () => {
                // onclose will fire after this, so let onclose handle reconnection.
                // Only set error state if we haven't started reconnecting.
                if (this.reconnectAttempts === 0) {
                    this.updateState({ error: 'WebSocket connection failed' });
                }
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
            this.updateState({
                status: 'error',
                error: errorMsg || `Disconnected after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`,
                sessionId: null,
                sseUrl: null,
            });
            return;
        }

        this.reconnectAttempts++;
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);

        this.updateState({
            status: 'reconnecting',
            error: `Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
            sessionId: null,
            sseUrl: null,
        });

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.doConnect();
        }, delay);
    }

    private startKeepalive(): void {
        this.stopKeepalive();

        // Send periodic pings to keep the WebSocket alive.
        // Browsers throttle setInterval in background tabs to ~1/min,
        // but WebSocket connections themselves stay open. The pings
        // ensure the relay doesn't consider us idle and close us.
        this.keepaliveTimer = window.setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, KEEPALIVE_INTERVAL_MS);

        // When the tab goes from hidden -> visible, send an immediate ping.
        // This compensates for throttled timers while backgrounded.
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible' && this.ws) {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                } else if (this.ws.readyState === WebSocket.CLOSED) {
                    // WebSocket died while we were in the background
                    this.ws = null;
                    this.stopKeepalive();
                    this.scheduleReconnect();
                }
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private stopKeepalive(): void {
        if (this.keepaliveTimer !== null) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    disconnect(): void {
        this.intentionalDisconnect = true;

        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.stopKeepalive();

        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
        }
        this.updateState({
            status: 'disconnected',
            sessionId: null,
            sseUrl: null,
            error: null,
        });
    }

    getState(): TunnelState {
        return this.state;
    }
}
