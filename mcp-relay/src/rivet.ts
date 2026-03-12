/**
 * Rivet Actor adapter for the MCP relay.
 *
 * Architecture:
 *   Browser <--WebSocket--> Rivet Actor <--SSE/POST--> MCP Client
 *
 * Each MCP session is a Rivet Actor. The actor uses `onRequest` for
 * HTTP traffic (SSE, POST) and `onWebSocket` for the browser connection.
 * The core RelaySession handles all message routing.
 *
 * Usage:
 *   import { registry } from './rivet';
 *   export default registry.serve();
 */

import { actor, setup } from 'rivetkit';
import {
    RelaySession,
    CORS_HEADERS,
    corsPreflightResponse,
    jsonResponse,
    textResponse,
    infoResponse,
} from './core';

// --- MCP Relay Actor ---

const mcpRelay = actor({
    // Non-serializable runtime state goes in vars
    vars: {
        relay: null as RelaySession | null,
    },

    createVars: () => ({
        relay: new RelaySession(),
    }),

    onRequest: async (c, req: Request): Promise<Response> => {
        const relay = c.vars.relay!;
        const url = new URL(req.url);
        const path = url.pathname;

        if (req.method === 'OPTIONS') {
            return corsPreflightResponse();
        }

        // GET /sse — MCP client SSE stream
        if (path.endsWith('/sse') && req.method === 'GET') {
            const origin = url.origin;
            // Build the endpoint base from the actor's URL
            const basePath = path.replace(/\/sse$/, '');
            return relay.handleSseConnect(`${origin}${basePath}`);
        }

        // POST /sse — HTTP Streamable transport
        if (path.endsWith('/sse') && req.method === 'POST') {
            const body = await req.text();
            return relay.handleStreamablePost(body, c.key.join(':'));
        }

        // DELETE /sse — session cleanup
        if (path.endsWith('/sse') && req.method === 'DELETE') {
            return relay.handleStreamableDelete();
        }

        // POST /message — MCP client sends message (SSE transport)
        if (path.includes('/message') && req.method === 'POST') {
            const clientId = url.searchParams.get('clientId') || '';
            const body = await req.text();
            return relay.handleMcpMessage(clientId, body);
        }

        return textResponse('Not Found', 404);
    },

    onWebSocket: (c, socket: WebSocket) => {
        const relay = c.vars.relay!;

        relay.setBrowserSend((msg) => socket.send(msg));

        socket.addEventListener('message', (event) => {
            const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
            relay.handleBrowserMessage(text);
        });

        socket.addEventListener('close', () => {
            relay.handleBrowserDisconnect();
        });

        socket.addEventListener('error', () => {
            relay.handleBrowserDisconnect();
        });
    },

    // Empty state — relay session is ephemeral (lives in vars)
    state: {},
    actions: {},
});

// --- Registry & entrypoint ---

export const registry = setup({
    use: { mcpRelay },
});

/**
 * If you want to add a custom HTTP router in front of the actor
 * (e.g. for the /session creation endpoint), use this handler with
 * your framework of choice:
 *
 *   import { Hono } from 'hono';
 *   import { registry, createSessionHandler } from './rivet';
 *
 *   const app = new Hono();
 *   app.post('/session', createSessionHandler(client));
 *   app.all('/api/rivet/*', (c) => registry.handler(c.req.raw));
 *   export default app;
 *
 * The /session endpoint creates a Rivet actor and returns its session ID.
 * MCP clients then connect to the actor's HTTP/WS endpoints directly.
 */

/**
 * Creates a /session handler that provisions a new mcpRelay actor.
 *
 * @param client - A Rivet client created with createClient<typeof registry>()
 */
export function createSessionHandler(client: ReturnType<typeof import('rivetkit/client').createClient>) {
    return async (_req: Request): Promise<Response> => {
        const sessionId = crypto.randomUUID();

        // Create the actor — it will be addressable by this key
        await (client as any).mcpRelay.getOrCreate([sessionId]);

        return jsonResponse({ sessionId });
    };
}
