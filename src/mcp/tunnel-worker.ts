/**
 * SharedWorker that manages the WebSocket tunnel to the Cloudflare relay.
 *
 * Why a SharedWorker:
 * - Timers (setInterval) are NOT throttled when the page is in a background tab.
 *   This means keepalive pings fire reliably, preventing idle disconnects.
 * - Survives navigation within the same origin — if the user reloads or
 *   navigates away and back, the WebSocket stays connected.
 * - Multiple tabs can share the same connection (only one "owns" it at a time).
 *
 * The MCP server logic stays on the main thread (it needs React state),
 * so this worker only handles the connection layer. MCP requests arrive
 * via WebSocket, get forwarded to the owning tab's MessagePort, and
 * responses come back the same way.
 */

const _self = self as unknown as SharedWorkerGlobalScope;

// --- Message types between worker and main thread ---

/** Main thread → Worker */
type MainToWorkerMessage =
    | { type: 'connect'; relayBaseUrl: string }
    | { type: 'disconnect' }
    | { type: 'mcp_response'; clientId: string; body: string };

/** Worker → Main thread */
type WorkerToMainMessage =
    | { type: 'state'; state: TunnelWorkerState }
    | { type: 'mcp_request'; clientId: string; body: string };

interface TunnelWorkerState {
    status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
    sessionId: string | null;
    sseUrl: string | null;
    error: string | null;
}

// --- Worker state ---

const KEEPALIVE_INTERVAL_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;

let ownerPort: MessagePort | null = null;
let ws: WebSocket | null = null;
let relayBaseUrl: string | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let intentionalDisconnect = false;

let currentState: TunnelWorkerState = {
    status: 'disconnected',
    sessionId: null,
    sseUrl: null,
    error: null,
};

// All connected tab ports (for broadcasting state)
const ports: Set<MessagePort> = new Set();

function broadcast(msg: WorkerToMainMessage): void {
    for (const port of ports) {
        port.postMessage(msg);
    }
}

function sendToOwner(msg: WorkerToMainMessage): void {
    if (ownerPort) {
        ownerPort.postMessage(msg);
    }
}

function updateState(patch: Partial<TunnelWorkerState>): void {
    currentState = { ...currentState, ...patch };
    broadcast({ type: 'state', state: currentState });
}

// --- WebSocket connection management ---

async function doConnect(): Promise<void> {
    if (!relayBaseUrl) return;

    const isReconnect = reconnectAttempts > 0;
    updateState({
        status: isReconnect ? 'reconnecting' : 'connecting',
        error: null,
    });

    try {
        // Create a session
        const sessionRes = await fetch(`${relayBaseUrl}/session`, { method: 'POST' });
        if (!sessionRes.ok) {
            throw new Error(`Failed to create session: HTTP ${sessionRes.status}`);
        }
        const { sessionId } = await sessionRes.json() as { sessionId: string };

        // Connect WebSocket
        const wsUrl = `${relayBaseUrl.replace(/^http/, 'ws')}/s/${sessionId}/ws`;
        const socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            reconnectAttempts = 0;
            const sseUrl = `${relayBaseUrl}/s/${sessionId}/sse`;
            updateState({
                status: 'connected',
                sessionId,
                sseUrl,
                error: null,
            });
            startKeepalive();
        };

        socket.onmessage = (event) => {
            try {
                const envelope = JSON.parse(event.data as string) as {
                    type: string;
                    clientId: string;
                    body: string;
                };

                if (envelope.type === 'mcp_request') {
                    // Forward to the owning tab for MCP processing
                    sendToOwner({
                        type: 'mcp_request',
                        clientId: envelope.clientId,
                        body: envelope.body,
                    });
                }
            } catch (err) {
                console.error('[tunnel-worker] Error handling message:', err);
            }
        };

        socket.onclose = () => {
            ws = null;
            stopKeepalive();
            if (!intentionalDisconnect && currentState.status === 'connected') {
                scheduleReconnect();
            } else if (!intentionalDisconnect) {
                updateState({
                    status: 'disconnected',
                    sessionId: null,
                    sseUrl: null,
                });
            }
        };

        socket.onerror = () => {
            if (reconnectAttempts === 0) {
                updateState({ error: 'WebSocket connection failed' });
            }
        };

        ws = socket;
    } catch (err) {
        if (!intentionalDisconnect) {
            scheduleReconnect(err instanceof Error ? err.message : 'Connection failed');
        }
    }
}

function scheduleReconnect(errorMsg?: string): void {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        updateState({
            status: 'error',
            error: errorMsg || `Disconnected after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`,
            sessionId: null,
            sseUrl: null,
        });
        return;
    }

    reconnectAttempts++;
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);

    updateState({
        status: 'reconnecting',
        error: `Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
        sessionId: null,
        sseUrl: null,
    });

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        doConnect();
    }, delay);
}

function startKeepalive(): void {
    stopKeepalive();
    // In a SharedWorker, setInterval is NOT throttled by the browser,
    // even when all connected tabs are in the background. This is the
    // main reason we use a SharedWorker for the tunnel.
    keepaliveTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive(): void {
    if (keepaliveTimer !== null) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
    }
}

function disconnect(): void {
    intentionalDisconnect = true;

    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    stopKeepalive();

    if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
    }

    updateState({
        status: 'disconnected',
        sessionId: null,
        sseUrl: null,
        error: null,
    });
}

// --- SharedWorker connection handling ---

_self.onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    ports.add(port);

    // New tab becomes the owner (it has the latest React state)
    ownerPort = port;

    // Send current state so the tab can hydrate immediately
    port.postMessage({ type: 'state', state: currentState });

    port.onmessage = (msg: MessageEvent<MainToWorkerMessage>) => {
        const data = msg.data;

        switch (data.type) {
            case 'connect':
                // This tab is taking ownership and starting a connection
                ownerPort = port;
                relayBaseUrl = data.relayBaseUrl.replace(/\/+$/, '');
                intentionalDisconnect = false;
                reconnectAttempts = 0;
                if (ws) disconnect();
                doConnect();
                break;

            case 'disconnect':
                disconnect();
                break;

            case 'mcp_response':
                // Forward MCP response from main thread back through WebSocket
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'mcp_response',
                        clientId: data.clientId,
                        body: data.body,
                    }));
                }
                break;
        }
    };

    // Clean up when a tab disconnects
    port.addEventListener('close', () => {
        ports.delete(port);
        if (ownerPort === port) {
            // Transfer ownership to another tab if available
            ownerPort = ports.size > 0 ? ports.values().next().value ?? null : null;
            if (!ownerPort) {
                // No tabs left — disconnect the tunnel
                disconnect();
            }
        }
    });
};
