/**
 * WebSocket tunnel client that connects the browser-side MCP server
 * to the Cloudflare Worker relay.
 *
 * Flow:
 * 1. POST /session to get a session ID
 * 2. Connect WebSocket to /s/{sessionId}/ws
 * 3. Relay incoming MCP requests to the McpServer, send responses back
 */

import type { McpServer } from './server';

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TunnelState {
    status: TunnelStatus;
    sessionId: string | null;
    sseUrl: string | null;
    error: string | null;
}

interface TunnelCallbacks {
    onStateChange: (state: TunnelState) => void;
}

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

        this.updateState({ status: 'connecting', error: null });

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
                const sseUrl = `${this.relayBaseUrl}/s/${sessionId}/sse`;
                this.updateState({
                    status: 'connected',
                    sessionId,
                    sseUrl,
                    error: null,
                });
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
                if (this.state.status === 'connected') {
                    this.updateState({
                        status: 'disconnected',
                        sessionId: null,
                        sseUrl: null,
                    });
                }
            };

            ws.onerror = () => {
                this.updateState({
                    status: 'error',
                    error: 'WebSocket connection failed',
                    sessionId: null,
                    sseUrl: null,
                });
            };

            this.ws = ws;
        } catch (err) {
            this.updateState({
                status: 'error',
                error: err instanceof Error ? err.message : 'Connection failed',
                sessionId: null,
                sseUrl: null,
            });
        }
    }

    disconnect(): void {
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
