/**
 * Platform-agnostic relay session logic.
 *
 * This module contains ALL the MCP relay message-routing logic,
 * independent of the networking layer. Platform adapters (Cloudflare
 * Durable Objects, Rivet Actors, standalone Node.js) wrap this core
 * and plug in their own WebSocket/HTTP handling.
 *
 * Architecture:
 *   Browser <--WebSocket--> RelaySession <--SSE/POST--> MCP Client
 *
 * The browser runs the actual MCP server logic. The relay just
 * forwards JSON-RPC messages between the browser and MCP clients.
 */

// --- Types ---

/** Minimal writable interface for SSE clients (works across platforms). */
export interface SseWriter {
    write(data: string): void;
    close(): void;
}

export interface PendingResponse {
    resolve: (body: string) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface RelaySessionOptions {
    /** How long to wait for a browser response before timing out (ms). */
    responseTimeoutMs?: number;
    /** Keep-alive ping interval for SSE connections (ms). */
    sseKeepAliveMs?: number;
}

const RESPONSE_TIMEOUT_MS = 30_000;
const SSE_KEEPALIVE_MS = 15_000;

// --- CORS helpers ---

export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

export function corsPreflightResponse(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
    });
}

export function textResponse(text: string, status: number, extraHeaders?: Record<string, string>): Response {
    return new Response(text, {
        status,
        headers: { ...CORS_HEADERS, ...extraHeaders },
    });
}

export function infoResponse(): Response {
    return jsonResponse({
        service: 'neolesk-mcp-relay',
        description: 'Relay for browser-based MCP servers',
        usage: 'POST /session to create a session, then connect via /s/{sessionId}/ws (browser) or /s/{sessionId}/sse (MCP client)',
    });
}

// --- RelaySession ---

/**
 * Core relay session. One instance per session (per browser connection).
 *
 * Platform adapters are responsible for:
 * 1. Creating/looking up sessions by ID
 * 2. Wiring up the browser WebSocket (call setBrowserSend / handleBrowserMessage / handleBrowserDisconnect)
 * 3. Routing HTTP requests to handleSse* / handleMcpMessage methods
 */
export class RelaySession {
    private browserSend: ((msg: string) => void) | null = null;
    private browserConnected = false;
    private sseClients = new Map<string, { writer: SseWriter; keepAlive: ReturnType<typeof setInterval> }>();
    private pendingResponses = new Map<string | number, PendingResponse>();
    private responseTimeoutMs: number;
    private sseKeepAliveMs: number;

    constructor(options?: RelaySessionOptions) {
        this.responseTimeoutMs = options?.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
        this.sseKeepAliveMs = options?.sseKeepAliveMs ?? SSE_KEEPALIVE_MS;
    }

    // --- Browser WebSocket lifecycle ---

    /** Register the browser's WebSocket send function. */
    setBrowserSend(send: (msg: string) => void): void {
        this.browserSend = send;
        this.browserConnected = true;
    }

    isBrowserConnected(): boolean {
        return this.browserConnected && this.browserSend !== null;
    }

    /** Called by the platform adapter when a message arrives from the browser WS. */
    handleBrowserMessage(text: string): void {
        let parsed: { type: string; clientId?: string; body?: string };
        try {
            parsed = JSON.parse(text);
        } catch {
            return;
        }

        if (parsed.type !== 'mcp_response' || !parsed.clientId || !parsed.body) {
            return;
        }

        // HTTP Streamable: resolve the pending response promise
        if (parsed.clientId === '__streamable__') {
            try {
                const responseJson = JSON.parse(parsed.body) as { id?: string | number };
                if (responseJson.id !== undefined) {
                    const pending = this.pendingResponses.get(responseJson.id);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pendingResponses.delete(responseJson.id);
                        pending.resolve(parsed.body);
                    }
                }
            } catch { /* ignore parse errors */ }
            return;
        }

        // SSE transport: write to SSE stream
        const client = this.sseClients.get(parsed.clientId);
        if (client) {
            try {
                client.writer.write(`event: message\ndata: ${parsed.body}\n\n`);
            } catch {
                this.cleanupSseClient(parsed.clientId);
            }
        }
    }

    /** Called by the platform adapter when the browser WS disconnects. */
    handleBrowserDisconnect(): void {
        this.browserSend = null;
        this.browserConnected = false;

        // Close all SSE clients
        for (const [id] of this.sseClients) {
            this.cleanupSseClient(id);
        }

        // Reject all pending responses
        for (const [id, pending] of this.pendingResponses) {
            clearTimeout(pending.timer);
            this.pendingResponses.delete(id);
            pending.resolve(JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32000, message: 'Browser disconnected' },
            }));
        }
    }

    // --- SSE transport (MCP client connects via GET, sends via POST /message) ---

    /**
     * Handle GET /sse — MCP client opens an SSE stream.
     * Returns a Response with the SSE stream using Web Streams API.
     *
     * @param endpointUrlBase - The base URL prefix for the /message endpoint
     *   (e.g. "https://relay.example.com/s/{sessionId}")
     */
    handleSseConnect(endpointUrlBase: string): Response {
        if (!this.isBrowserConnected()) {
            return textResponse('No browser connected', 503);
        }

        const clientId = crypto.randomUUID();
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const streamWriter = writable.getWriter();

        const sseWriter: SseWriter = {
            write: (data: string) => {
                streamWriter.write(encoder.encode(data)).catch(() => {
                    this.cleanupSseClient(clientId);
                });
            },
            close: () => {
                streamWriter.close().catch(() => {});
            },
        };

        // Keep-alive ping
        const keepAlive = setInterval(() => {
            try {
                sseWriter.write(': ping\n\n');
            } catch {
                this.cleanupSseClient(clientId);
            }
        }, this.sseKeepAliveMs);

        this.sseClients.set(clientId, { writer: sseWriter, keepAlive });

        // Send endpoint event
        const endpointUrl = `${endpointUrlBase}/message?clientId=${clientId}`;
        sseWriter.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

        // Detect client disconnect via tee
        const [responseBranch, watchBranch] = readable.tee();
        watchBranch.pipeTo(new WritableStream()).catch(() => {
            this.cleanupSseClient(clientId);
        });

        return new Response(responseBranch, {
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    }

    /**
     * Handle POST /message — MCP client sends a JSON-RPC message (SSE transport).
     * The message is forwarded to the browser via WebSocket; the response comes
     * back asynchronously over the SSE stream.
     */
    handleMcpMessage(clientId: string, body: string): Response {
        if (!this.isBrowserConnected()) {
            return textResponse('No browser connected', 503);
        }

        if (!clientId || !this.sseClients.has(clientId)) {
            return textResponse('Unknown client', 400);
        }

        try {
            this.browserSend!(JSON.stringify({
                type: 'mcp_request',
                clientId,
                body,
            }));
        } catch {
            return textResponse('Browser disconnected', 503);
        }

        return textResponse('Accepted', 202);
    }

    // --- HTTP Streamable transport (POST to /sse) ---

    /**
     * Handle POST /sse — HTTP Streamable transport.
     * Forward JSON-RPC to the browser and wait for the response inline.
     */
    async handleStreamablePost(body: string, sessionId: string): Promise<Response> {
        if (!this.isBrowserConnected()) {
            return textResponse('No browser connected', 503);
        }

        let parsed: { id?: string | number; method?: string };
        try {
            parsed = JSON.parse(body);
        } catch {
            return textResponse('Invalid JSON', 400);
        }

        const streamableHeaders = { 'Mcp-Session-Id': sessionId };

        // Notifications (no id) don't expect a response
        if (parsed.id === undefined) {
            try {
                this.browserSend!(JSON.stringify({
                    type: 'mcp_request',
                    clientId: '__streamable__',
                    body,
                }));
            } catch {
                return textResponse('Browser disconnected', 503, streamableHeaders);
            }
            return new Response(null, { status: 202, headers: { ...CORS_HEADERS, ...streamableHeaders } });
        }

        // Requests with an id: forward and wait for response
        const requestId = parsed.id;

        const responsePromise = new Promise<string>((resolve) => {
            const timer = setTimeout(() => {
                this.pendingResponses.delete(requestId);
                resolve(JSON.stringify({
                    jsonrpc: '2.0',
                    id: requestId,
                    error: { code: -32000, message: 'Timeout waiting for browser response' },
                }));
            }, this.responseTimeoutMs);
            this.pendingResponses.set(requestId, { resolve, timer });
        });

        try {
            this.browserSend!(JSON.stringify({
                type: 'mcp_request',
                clientId: '__streamable__',
                body,
            }));
        } catch {
            this.pendingResponses.delete(requestId);
            return textResponse('Browser disconnected', 503, streamableHeaders);
        }

        const responseBody = await responsePromise;

        return new Response(responseBody, {
            headers: {
                ...CORS_HEADERS,
                ...streamableHeaders,
                'Content-Type': 'application/json',
            },
        });
    }

    /** Handle DELETE /sse — session cleanup. */
    handleStreamableDelete(): Response {
        return new Response(null, { status: 200, headers: CORS_HEADERS });
    }

    // --- Internal helpers ---

    private cleanupSseClient(clientId: string): void {
        const client = this.sseClients.get(clientId);
        if (client) {
            clearInterval(client.keepAlive);
            try { client.writer.close(); } catch { /* ignore */ }
            this.sseClients.delete(clientId);
        }
    }
}
