/**
 * Cloudflare Worker + Durable Objects adapter for the MCP relay.
 *
 * Architecture:
 *   Browser <--WebSocket--> Durable Object <--SSE/POST--> MCP Client
 *
 * The Worker entrypoint routes requests to per-session Durable Objects.
 * Each DO wraps a RelaySession from core.ts and wires up the CF-specific
 * WebSocket hibernation API.
 */

import {
    RelaySession,
    CORS_HEADERS,
    corsPreflightResponse,
    jsonResponse,
    infoResponse,
} from './core';

interface Env {
    MCP_RELAY: DurableObjectNamespace;
}

// --- Durable Object: McpRelay ---

export class McpRelay {
    private state: DurableObjectState;
    private relay: RelaySession;
    private browserSocket: WebSocket | null = null;

    constructor(state: DurableObjectState) {
        this.state = state;
        this.relay = new RelaySession();
    }

    /** Recover browser WebSocket after hibernation wake-up. */
    private ensureBrowserSocket(): void {
        if (this.browserSocket) return;
        const sockets = this.state.getWebSockets();
        if (sockets.length > 0) {
            this.browserSocket = sockets[0];
            this.relay.setBrowserSend((msg) => this.browserSocket!.send(msg));
        }
    }

    async fetch(request: Request): Promise<Response> {
        this.ensureBrowserSocket();
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return corsPreflightResponse();
        }

        // Browser connects via WebSocket
        if (path === '/ws') {
            return this.handleBrowserWebSocket(request);
        }

        // MCP client connects via SSE (GET)
        if (path === '/sse' && request.method === 'GET') {
            const sessionPrefix = request.headers.get('X-Session-Prefix') || '';
            const origin = new URL(request.url).origin;
            return this.relay.handleSseConnect(`${origin}${sessionPrefix}`);
        }

        // HTTP Streamable: POST to /sse
        if (path === '/sse' && request.method === 'POST') {
            const body = await request.text();
            return this.relay.handleStreamablePost(body, this.state.id.toString());
        }

        // HTTP Streamable: DELETE to /sse
        if (path === '/sse' && request.method === 'DELETE') {
            return this.relay.handleStreamableDelete();
        }

        // MCP client sends messages via POST (SSE transport)
        if (path.startsWith('/message') && request.method === 'POST') {
            const clientId = url.searchParams.get('clientId') || '';
            const body = await request.text();
            return this.relay.handleMcpMessage(clientId, body);
        }

        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    }

    private handleBrowserWebSocket(request: Request): Response {
        const upgradeHeader = request.headers.get('Upgrade');
        if (upgradeHeader !== 'websocket') {
            return new Response('Expected WebSocket', { status: 426, headers: CORS_HEADERS });
        }

        // Close existing browser socket if any
        if (this.browserSocket) {
            try { this.browserSocket.close(1000, 'replaced'); } catch { /* ignore */ }
            this.relay.handleBrowserDisconnect();
        }

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];

        this.state.acceptWebSocket(server);
        this.browserSocket = server;
        this.relay.setBrowserSend((msg) => server.send(msg));

        return new Response(null, { status: 101, webSocket: client });
    }

    // Hibernation API callbacks
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
        this.relay.handleBrowserMessage(text);
    }

    async webSocketClose(ws: WebSocket) {
        if (ws === this.browserSocket) {
            this.browserSocket = null;
            this.relay.handleBrowserDisconnect();
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

        if (request.method === 'OPTIONS') {
            return corsPreflightResponse();
        }

        // POST /session — create a new relay session
        if (path === '/session' && request.method === 'POST') {
            const sessionId = crypto.randomUUID();
            return jsonResponse({ sessionId });
        }

        // Root — info
        if (path === '/') {
            return infoResponse();
        }

        // All other routes: /s/{sessionId}/...
        const sessionMatch = path.match(/^\/s\/([a-f0-9-]+)(\/.*)?$/);
        if (!sessionMatch) {
            return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
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

        return stub.fetch(new Request(doUrl.toString(), {
            method: request.method,
            headers,
            body: request.body,
        }));
    },
};
