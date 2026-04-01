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

    /** Recover browser WebSocket after hibernation wake-up. */
    private ensureBrowserSocket(): void {
        if (this.browserSocket) return;
        const sockets = this.state.getWebSockets();
        if (sockets.length > 0) {
            this.browserSocket = sockets[0];
            this.sessionReady = true;
        }
    }

    async fetch(request: Request): Promise<Response> {
        this.ensureBrowserSocket();
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers for all responses
        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Browser connects via WebSocket
        if (path === '/ws') {
            return this.handleBrowserWebSocket(request, corsHeaders);
        }

        // MCP client connects via SSE (GET) or HTTP Streamable (POST)
        if (path === '/sse' && request.method === 'GET') {
            return this.handleMcpSse(request, corsHeaders);
        }

        // HTTP Streamable: POST to /sse sends a JSON-RPC message and gets response inline
        if (path === '/sse' && request.method === 'POST') {
            return this.handleStreamablePost(request, corsHeaders);
        }

        // HTTP Streamable: DELETE to /sse terminates the session
        if (path === '/sse' && request.method === 'DELETE') {
            return new Response(null, { status: 200, headers: corsHeaders });
        }

        // MCP client sends messages via POST (SSE transport)
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

    private handleMcpSse(request: Request, corsHeaders: Record<string, string>): Response {
        if (!this.sessionReady || !this.browserSocket) {
            return new Response('No browser connected', { status: 503, headers: corsHeaders });
        }

        const clientId = crypto.randomUUID();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();

        this.sseClients.set(clientId, writer);

        // Build absolute endpoint URL so all MCP clients can resolve it
        const sessionPrefix = request.headers.get('X-Session-Prefix') || '';
        const origin = new URL(request.url).origin;
        const endpointUrl = `${origin}${sessionPrefix}/message?clientId=${clientId}`;
        const endpointEvent = `event: endpoint\ndata: ${endpointUrl}\n\n`;
        writer.write(this.encoder.encode(endpointEvent)).catch(() => {
            this.sseClients.delete(clientId);
        });

        // Clean up when the client disconnects
        const cleanup = () => {
            this.sseClients.delete(clientId);
            if (keepAlive) clearInterval(keepAlive);
            writer.close().catch(() => {});
        };

        // Keep-alive ping every 15 seconds
        const keepAlive = setInterval(() => {
            writer.write(this.encoder.encode(': ping\n\n')).catch(() => {
                cleanup();
            });
        }, 15000);

        // Use a tee: one branch for the Response, the other to detect client disconnect
        const [responseBranch, watchBranch] = readable.tee();
        watchBranch.pipeTo(new WritableStream()).catch(() => { cleanup(); });

        return new Response(responseBranch, {
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

    /**
     * HTTP Streamable transport: POST to /sse.
     * Forward the JSON-RPC request to the browser and wait for the response,
     * returning it directly (or as an SSE stream for requests that expect one).
     */
    private async handleStreamablePost(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
        if (!this.sessionReady || !this.browserSocket) {
            return new Response('No browser connected', { status: 503, headers: corsHeaders });
        }

        const body = await request.text();
        let parsed: { id?: string | number; method?: string };
        try {
            parsed = JSON.parse(body);
        } catch {
            return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
        }

        // Session ID for HTTP Streamable transport
        const mcpSessionId = this.state.id.toString();
        const streamableHeaders = { ...corsHeaders, 'Mcp-Session-Id': mcpSessionId };

        // Notifications (no id) don't expect a response
        if (parsed.id === undefined) {
            try {
                this.browserSocket.send(JSON.stringify({
                    type: 'mcp_request',
                    clientId: '__streamable__',
                    body,
                }));
            } catch {
                return new Response('Browser disconnected', { status: 503, headers: streamableHeaders });
            }
            return new Response(null, { status: 202, headers: streamableHeaders });
        }

        // Requests with an id: forward and wait for response
        const requestId = parsed.id;

        const responsePromise = new Promise<string>((resolve) => {
            const timeout = setTimeout(() => {
                this.pendingResponses.delete(requestId);
                resolve(JSON.stringify({ jsonrpc: '2.0', id: requestId, error: { code: -32000, message: 'Timeout waiting for browser response' } }));
            }, 30000) as unknown as number;
            this.pendingResponses.set(requestId, { resolve, timeout });
        });

        try {
            this.browserSocket.send(JSON.stringify({
                type: 'mcp_request',
                clientId: '__streamable__',
                body,
            }));
        } catch {
            this.pendingResponses.delete(requestId);
            return new Response('Browser disconnected', { status: 503, headers: corsHeaders });
        }

        const responseBody = await responsePromise;

        return new Response(responseBody, {
            headers: {
                ...streamableHeaders,
                'Content-Type': 'application/json',
            },
        });
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
            // HTTP Streamable: resolve the pending response promise
            if (parsed.clientId === '__streamable__') {
                try {
                    const responseJson = JSON.parse(parsed.body) as { id?: string | number };
                    if (responseJson.id !== undefined) {
                        const pending = this.pendingResponses.get(responseJson.id);
                        if (pending) {
                            clearTimeout(pending.timeout);
                            this.pendingResponses.delete(responseJson.id);
                            pending.resolve(parsed.body);
                        }
                    }
                } catch {}
                return;
            }

            // SSE transport: write to SSE stream
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
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
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

        // Pass the session prefix so the DO can construct absolute URLs
        const headers = new Headers(request.headers);
        headers.set('X-Session-Prefix', `/s/${sessionId}`);

        return stub.fetch(new Request(doUrl.toString(), { method: request.method, headers, body: request.body }));
    },
};
