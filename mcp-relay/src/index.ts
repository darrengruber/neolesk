/**
 * Cloudflare Worker relay for browser-based MCP server.
 *
 * Architecture:
 *   Browser <--WebSocket--> Durable Object <--SSE/POST--> MCP Client
 *
 * The browser runs the actual MCP server logic. This Worker just relays
 * JSON-RPC messages between the browser (via WebSocket) and external MCP
 * clients (via the standard MCP SSE transport).
 */

interface Env {
    MCP_RELAY: DurableObjectNamespace;
}

// --- Durable Object: McpRelay ---

interface PendingResponse {
    resolve: (body: string) => void;
    timeout: number;
}

export class McpRelay {
    private state: DurableObjectState;
    private browserSocket: WebSocket | null = null;
    private sseClients: Map<string, WritableStreamDefaultWriter<Uint8Array>> = new Map();
    private pendingResponses: Map<string | number, PendingResponse> = new Map();
    private encoder = new TextEncoder();
    private sessionReady = false;

    constructor(state: DurableObjectState) {
        this.state = state;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers for all responses
        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Browser connects via WebSocket
        if (path === '/ws') {
            return this.handleBrowserWebSocket(request, corsHeaders);
        }

        // MCP client connects via SSE
        if (path === '/sse' && request.method === 'GET') {
            return this.handleMcpSse(request, corsHeaders);
        }

        // MCP client sends messages via POST
        if (path.startsWith('/message') && request.method === 'POST') {
            return this.handleMcpMessage(request, corsHeaders);
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }

    private handleBrowserWebSocket(request: Request, corsHeaders: Record<string, string>): Response {
        const upgradeHeader = request.headers.get('Upgrade');
        if (upgradeHeader !== 'websocket') {
            return new Response('Expected WebSocket', { status: 426, headers: corsHeaders });
        }

        // Close existing browser socket if any
        if (this.browserSocket) {
            try { this.browserSocket.close(1000, 'replaced'); } catch {}
            this.browserSocket = null;
        }

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];

        this.state.acceptWebSocket(server);
        this.browserSocket = server;
        this.sessionReady = true;

        return new Response(null, { status: 101, webSocket: client });
    }

    private handleMcpSse(_request: Request, corsHeaders: Record<string, string>): Response {
        if (!this.sessionReady || !this.browserSocket) {
            return new Response('No browser connected', { status: 503, headers: corsHeaders });
        }

        const clientId = crypto.randomUUID();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();

        this.sseClients.set(clientId, writer);

        // Send the endpoint event so the MCP client knows where to POST messages
        const endpointUrl = `/message?clientId=${clientId}`;
        const endpointEvent = `event: endpoint\ndata: ${endpointUrl}\n\n`;
        writer.write(this.encoder.encode(endpointEvent)).catch(() => {
            this.sseClients.delete(clientId);
        });

        // Clean up when the client disconnects
        const cleanup = () => {
            this.sseClients.delete(clientId);
            writer.close().catch(() => {});
        };

        // Keep-alive ping every 15 seconds
        const keepAlive = setInterval(() => {
            writer.write(this.encoder.encode(': ping\n\n')).catch(() => {
                clearInterval(keepAlive);
                cleanup();
            });
        }, 15000);

        // When the readable side is cancelled (client disconnect), clean up
        readable.pipeTo(new WritableStream({
            close: () => { clearInterval(keepAlive); cleanup(); },
            abort: () => { clearInterval(keepAlive); cleanup(); },
        })).catch(() => { clearInterval(keepAlive); cleanup(); });

        return new Response(readable, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    }

    private async handleMcpMessage(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
        if (!this.sessionReady || !this.browserSocket) {
            return new Response('No browser connected', { status: 503, headers: corsHeaders });
        }

        const url = new URL(request.url);
        const clientId = url.searchParams.get('clientId');
        if (!clientId || !this.sseClients.has(clientId)) {
            return new Response('Unknown client', { status: 400, headers: corsHeaders });
        }

        const body = await request.text();

        // Forward the message to the browser via WebSocket
        try {
            this.browserSocket.send(JSON.stringify({
                type: 'mcp_request',
                clientId,
                body,
            }));
        } catch {
            return new Response('Browser disconnected', { status: 503, headers: corsHeaders });
        }

        return new Response('Accepted', { status: 202, headers: corsHeaders });
    }

    // Handle WebSocket messages from the browser
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
        let parsed: { type: string; clientId?: string; body?: string };

        try {
            parsed = JSON.parse(text);
        } catch {
            return;
        }

        if (parsed.type === 'mcp_response' && parsed.clientId && parsed.body) {
            const writer = this.sseClients.get(parsed.clientId);
            if (writer) {
                const sseEvent = `event: message\ndata: ${parsed.body}\n\n`;
                writer.write(this.encoder.encode(sseEvent)).catch(() => {
                    this.sseClients.delete(parsed.clientId!);
                });
            }
        }
    }

    async webSocketClose(ws: WebSocket) {
        if (ws === this.browserSocket) {
            this.browserSocket = null;
            this.sessionReady = false;

            // Close all SSE clients
            for (const [id, writer] of this.sseClients) {
                writer.close().catch(() => {});
                this.sseClients.delete(id);
            }
        }
    }

    async webSocketError(ws: WebSocket) {
        this.webSocketClose(ws);
    }
}

// --- Worker entrypoint ---

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Route: POST /session - Create a new relay session
        if (path === '/session' && request.method === 'POST') {
            const sessionId = crypto.randomUUID();
            return new Response(JSON.stringify({ sessionId }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // All other routes require a session ID: /s/{sessionId}/...
        const sessionMatch = path.match(/^\/s\/([a-f0-9-]+)(\/.*)?$/);
        if (!sessionMatch) {
            // Root path - show info
            if (path === '/') {
                return new Response(JSON.stringify({
                    service: 'neolesk-mcp-relay',
                    description: 'Relay for browser-based MCP servers',
                    usage: 'POST /session to create a session, then connect via /s/{sessionId}/ws (browser) or /s/{sessionId}/sse (MCP client)',
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
            return new Response('Not Found', { status: 404, headers: corsHeaders });
        }

        const sessionId = sessionMatch[1];
        const subPath = sessionMatch[2] || '/';

        // Route to the Durable Object for this session
        const doId = env.MCP_RELAY.idFromName(sessionId);
        const stub = env.MCP_RELAY.get(doId);

        // Rewrite the URL to just the sub-path for the DO
        const doUrl = new URL(request.url);
        doUrl.pathname = subPath;

        return stub.fetch(new Request(doUrl.toString(), request));
    },
};
