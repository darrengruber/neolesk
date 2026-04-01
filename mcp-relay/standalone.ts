/**
 * Standalone relay server for browser-based MCP server.
 *
 * This is a Node.js equivalent of the Cloudflare Worker relay (src/index.ts),
 * using in-memory state instead of Durable Objects. Suitable for single-instance
 * deployment in Kubernetes.
 *
 * Architecture:
 *   Browser <--WebSocket--> This server <--SSE/POST--> MCP Client
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3001', 10);

// --- Session state ---

interface PendingResponse {
    resolve: (body: string) => void;
    timeout: ReturnType<typeof setTimeout>;
}

interface SseClient {
    res: ServerResponse;
    keepAlive: ReturnType<typeof setInterval>;
}

interface Session {
    browserSocket: WebSocket | null;
    sseClients: Map<string, SseClient>;
    pendingResponses: Map<string | number, PendingResponse>;
}

const sessions = new Map<string, Session>();

function getOrCreateSession(sessionId: string): Session {
    let session = sessions.get(sessionId);
    if (!session) {
        session = {
            browserSocket: null,
            sseClients: new Map(),
            pendingResponses: new Map(),
        };
        sessions.set(sessionId, session);
    }
    return session;
}

// --- CORS ---

const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function setCors(res: ServerResponse): void {
    for (const [k, v] of Object.entries(corsHeaders)) {
        res.setHeader(k, v);
    }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    setCors(res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string): void {
    setCors(res);
    res.writeHead(status);
    res.end(text);
}

// --- Helpers ---

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

// --- WebSocket message handler ---

function handleBrowserMessage(session: Session, data: string): void {
    let parsed: { type: string; clientId?: string; body?: string };
    try {
        parsed = JSON.parse(data);
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
                const pending = session.pendingResponses.get(responseJson.id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    session.pendingResponses.delete(responseJson.id);
                    pending.resolve(parsed.body);
                }
            }
        } catch {}
        return;
    }

    // SSE transport: write to SSE stream
    const client = session.sseClients.get(parsed.clientId);
    if (client) {
        try {
            client.res.write(`event: message\ndata: ${parsed.body}\n\n`);
        } catch {
            cleanupSseClient(session, parsed.clientId);
        }
    }
}

function cleanupSseClient(session: Session, clientId: string): void {
    const client = session.sseClients.get(clientId);
    if (client) {
        clearInterval(client.keepAlive);
        try { client.res.end(); } catch {}
        session.sseClients.delete(clientId);
    }
}

function cleanupSession(session: Session): void {
    for (const [id] of session.sseClients) {
        cleanupSseClient(session, id);
    }
    for (const [id, pending] of session.pendingResponses) {
        clearTimeout(pending.timeout);
        session.pendingResponses.delete(id);
    }
}

// --- HTTP server ---

const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
        setCors(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // POST /session — create a new relay session
    if (path === '/session' && method === 'POST') {
        const sessionId = randomUUID();
        getOrCreateSession(sessionId);
        sendJson(res, 200, { sessionId });
        return;
    }

    // Root info
    if (path === '/') {
        sendJson(res, 200, {
            service: 'neolesk-mcp-relay',
            description: 'Relay for browser-based MCP servers',
            usage: 'POST /session to create a session, then connect via /s/{sessionId}/ws (browser) or /s/{sessionId}/sse (MCP client)',
        });
        return;
    }

    // All other routes: /s/{sessionId}/...
    const match = path.match(/^\/s\/([a-f0-9-]+)(\/.*)?$/);
    if (!match) {
        sendText(res, 404, 'Not Found');
        return;
    }

    const sessionId = match[1];
    const subPath = match[2] || '/';
    const session = getOrCreateSession(sessionId);

    // GET /s/{id}/sse — MCP client SSE stream
    if (subPath === '/sse' && method === 'GET') {
        if (!session.browserSocket || session.browserSocket.readyState !== WebSocket.OPEN) {
            sendText(res, 503, 'No browser connected');
            return;
        }

        const clientId = randomUUID();
        setCors(res);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        // Send endpoint event
        const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const endpointUrl = `${origin}/s/${sessionId}/message?clientId=${clientId}`;
        res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

        // Keep-alive ping every 15 seconds
        const keepAlive = setInterval(() => {
            try {
                res.write(': ping\n\n');
            } catch {
                cleanupSseClient(session, clientId);
            }
        }, 15000);

        session.sseClients.set(clientId, { res, keepAlive });

        // Clean up on disconnect
        req.on('close', () => cleanupSseClient(session, clientId));
        return;
    }

    // POST /s/{id}/sse — HTTP Streamable transport
    if (subPath === '/sse' && method === 'POST') {
        if (!session.browserSocket || session.browserSocket.readyState !== WebSocket.OPEN) {
            sendText(res, 503, 'No browser connected');
            return;
        }

        const body = await readBody(req);
        let parsed: { id?: string | number; method?: string };
        try {
            parsed = JSON.parse(body);
        } catch {
            sendText(res, 400, 'Invalid JSON');
            return;
        }

        const mcpSessionId = sessionId;
        setCors(res);
        res.setHeader('Mcp-Session-Id', mcpSessionId);

        // Notifications (no id) don't expect a response
        if (parsed.id === undefined) {
            try {
                session.browserSocket.send(JSON.stringify({
                    type: 'mcp_request',
                    clientId: '__streamable__',
                    body,
                }));
            } catch {
                res.writeHead(503);
                res.end('Browser disconnected');
                return;
            }
            res.writeHead(202);
            res.end();
            return;
        }

        // Requests with an id: forward and wait for response
        const requestId = parsed.id;

        const responsePromise = new Promise<string>((resolve) => {
            const timeout = setTimeout(() => {
                session.pendingResponses.delete(requestId);
                resolve(JSON.stringify({
                    jsonrpc: '2.0',
                    id: requestId,
                    error: { code: -32000, message: 'Timeout waiting for browser response' },
                }));
            }, 30000);
            session.pendingResponses.set(requestId, { resolve, timeout });
        });

        try {
            session.browserSocket.send(JSON.stringify({
                type: 'mcp_request',
                clientId: '__streamable__',
                body,
            }));
        } catch {
            session.pendingResponses.delete(requestId);
            res.writeHead(503);
            res.end('Browser disconnected');
            return;
        }

        const responseBody = await responsePromise;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(responseBody);
        return;
    }

    // DELETE /s/{id}/sse — session cleanup
    if (subPath === '/sse' && method === 'DELETE') {
        setCors(res);
        res.writeHead(200);
        res.end();
        return;
    }

    // POST /s/{id}/message — MCP client sends message (SSE transport)
    if (subPath.startsWith('/message') && method === 'POST') {
        if (!session.browserSocket || session.browserSocket.readyState !== WebSocket.OPEN) {
            sendText(res, 503, 'No browser connected');
            return;
        }

        const clientId = url.searchParams.get('clientId');
        if (!clientId || !session.sseClients.has(clientId)) {
            sendText(res, 400, 'Unknown client');
            return;
        }

        const body = await readBody(req);
        try {
            session.browserSocket.send(JSON.stringify({
                type: 'mcp_request',
                clientId,
                body,
            }));
        } catch {
            sendText(res, 503, 'Browser disconnected');
            return;
        }

        sendText(res, 202, 'Accepted');
        return;
    }

    sendText(res, 404, 'Not Found');
});

// --- WebSocket upgrade ---

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const match = url.pathname.match(/^\/s\/([a-f0-9-]+)\/ws$/);
    if (!match) {
        socket.destroy();
        return;
    }

    const sessionId = match[1];
    const session = getOrCreateSession(sessionId);

    wss.handleUpgrade(req, socket, head, (ws) => {
        // Close existing browser socket if any
        if (session.browserSocket) {
            try { session.browserSocket.close(1000, 'replaced'); } catch {}
        }

        session.browserSocket = ws;

        ws.on('message', (data) => {
            const text = typeof data === 'string' ? data : data.toString();
            handleBrowserMessage(session, text);
        });

        ws.on('close', () => {
            if (session.browserSocket === ws) {
                session.browserSocket = null;
                cleanupSession(session);
            }
        });

        ws.on('error', () => {
            if (session.browserSocket === ws) {
                session.browserSocket = null;
                cleanupSession(session);
            }
        });
    });
});

// --- Start ---

server.listen(PORT, () => {
    console.log(`MCP relay listening on port ${PORT}`);
});
