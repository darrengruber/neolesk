/**
 * Standalone relay server for browser-based MCP server.
 *
 * Node.js adapter that wraps the shared RelaySession core.
 * Uses in-memory session management. Suitable for single-instance
 * deployment in Kubernetes or local development.
 *
 * Architecture:
 *   Browser <--WebSocket--> This server <--SSE/POST--> MCP Client
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RelaySession, CORS_HEADERS } from './src/core';

const PORT = parseInt(process.env.PORT || '3001', 10);

// --- Session management ---

const sessions = new Map<string, RelaySession>();

function getOrCreateSession(sessionId: string): RelaySession {
    let session = sessions.get(sessionId);
    if (!session) {
        session = new RelaySession();
        sessions.set(sessionId, session);
    }
    return session;
}

// --- Node.js helpers ---

function setCors(res: ServerResponse): void {
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
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

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

/**
 * Convert a Web API Response (from RelaySession) to a Node.js ServerResponse.
 * Handles both regular responses and streaming SSE responses.
 */
async function sendWebResponse(webRes: Response, nodeRes: ServerResponse): Promise<void> {
    // Copy headers
    webRes.headers.forEach((value, key) => {
        nodeRes.setHeader(key, value);
    });
    nodeRes.writeHead(webRes.status);

    if (!webRes.body) {
        nodeRes.end();
        return;
    }

    // Stream the body
    const reader = webRes.body.getReader();
    const pump = async () => {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!nodeRes.destroyed) {
                nodeRes.write(value);
            } else {
                reader.cancel();
                break;
            }
        }
    };

    // Don't end the response for SSE streams — let them stay open
    // until the reader is done (client disconnect closes the stream)
    nodeRes.on('close', () => {
        reader.cancel().catch(() => {});
    });

    pump().catch(() => {
        reader.cancel().catch(() => {});
    });
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
        const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const webRes = session.handleSseConnect(`${origin}/s/${sessionId}`);
        await sendWebResponse(webRes, res);
        return;
    }

    // POST /s/{id}/sse — HTTP Streamable transport
    if (subPath === '/sse' && method === 'POST') {
        const body = await readBody(req);
        const webRes = await session.handleStreamablePost(body, sessionId);
        await sendWebResponse(webRes, res);
        return;
    }

    // DELETE /s/{id}/sse — session cleanup
    if (subPath === '/sse' && method === 'DELETE') {
        const webRes = session.handleStreamableDelete();
        await sendWebResponse(webRes, res);
        return;
    }

    // POST /s/{id}/message — MCP client sends message (SSE transport)
    if (subPath.startsWith('/message') && method === 'POST') {
        const clientId = url.searchParams.get('clientId') || '';
        const body = await readBody(req);
        const webRes = session.handleMcpMessage(clientId, body);
        await sendWebResponse(webRes, res);
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
        // Close existing browser socket if any — handleBrowserDisconnect
        // cleans up SSE clients and pending responses
        session.handleBrowserDisconnect();

        session.setBrowserSend((msg) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
            }
        });

        ws.on('message', (data) => {
            const text = typeof data === 'string' ? data : data.toString();
            session.handleBrowserMessage(text);
        });

        ws.on('close', () => {
            session.handleBrowserDisconnect();
        });

        ws.on('error', () => {
            session.handleBrowserDisconnect();
        });
    });
});

// --- Start ---

server.listen(PORT, () => {
    console.log(`MCP relay listening on port ${PORT}`);
});
