import { EphemeralStore, LoroDoc, UndoManager } from 'loro-crdt/bundler';
import type { CollaborationBinding } from '../editor/CodeMirrorEditor';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { SessionSnapshot } from './sessionDocument';

export interface SessionLinks {
    id: string;
    sessionUrl: string;
    websocketUrl: string;
    mcpUrl: string;
}

export interface SessionPresence {
    state: 'connected' | 'disconnected';
    actor?: 'human' | 'agent';
    actorId?: string;
}

export interface SessionActivity {
    actor: 'human' | 'agent';
    actorId?: string;
    fields: string[];
}

export const createSession = async (
    backendUrl: string,
    initial: SessionSnapshot,
    fetchImpl: typeof fetch = fetch,
): Promise<SessionLinks> => {
    const response = await fetchImpl(new URL('/api/sessions', backendUrl).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initial),
    });
    if (!response.ok) throw new Error((await response.text()) || `Could not create session (HTTP ${response.status})`);
    return response.json() as Promise<SessionLinks>;
};

export const createSessionAvailabilityProbe = (
    backendUrl: string,
    sessionId: string,
    fetchImpl: typeof fetch = fetch,
) => async (): Promise<boolean> => {
    try {
        const response = await fetchImpl(
            new URL(`/api/sessions/${encodeURIComponent(sessionId)}/presence`, backendUrl).href,
            { headers: { accept: 'application/json' } },
        );
        return response.status !== 404 && response.status !== 410;
    } catch {
        return true;
    }
};

export const getSessionIdFromPath = (pathname: string): string | null => {
    const match = pathname.match(/^\/s\/([0-9a-f]{64})\/?$/i);
    return match?.[1] || null;
};

type ParticipantStorage = Pick<Storage, 'getItem' | 'setItem'>;

const participantId = (websocketUrl: string, storage?: ParticipantStorage): string => {
    let key = 'neolesk:participant:session';
    try {
        key = `neolesk:participant:${new URL(websocketUrl).pathname}`;
        const existing = storage?.getItem(key);
        if (existing && /^browser-[0-9a-f]{16}$/.test(existing)) return existing;
    } catch {
        // A random in-memory identity still keeps the client usable when storage is unavailable.
    }
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const generated = `browser-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    try {
        storage?.setItem(key, generated);
    } catch {
        // Ignore disabled or full tab storage.
    }
    return generated;
};

export const createSessionClient = ({
    websocketUrl,
    WebSocketImpl = WebSocket,
    onState,
    onBinding,
    onPresence,
    onActivity,
    onError,
    onClosed,
    onSocket,
    reconnectBaseDelayMs = 500,
    canReconnect,
    participantStorage,
}: {
    websocketUrl: string;
    WebSocketImpl?: typeof WebSocket;
    onState?: (state: SessionSnapshot) => void;
    onBinding?: (binding: CollaborationBinding | null) => void;
    onPresence?: (presence: SessionPresence) => void;
    onActivity?: (activity: SessionActivity) => void;
    onError?: (message: string) => void;
    onClosed?: (reason: 'closed' | 'expired') => void;
    onSocket?: (socket: WebSocket) => void;
    reconnectBaseDelayMs?: number;
    canReconnect?: () => Promise<boolean>;
    participantStorage?: ParticipantStorage;
}) => {
    let defaultParticipantStorage: ParticipantStorage | undefined;
    try {
        defaultParticipantStorage = globalThis.sessionStorage;
    } catch {
        defaultParticipantStorage = undefined;
    }
    const actorId = participantId(websocketUrl, participantStorage || defaultParticipantStorage);
    let socket: WebSocket | null = null;
    let doc: LoroDoc | null = null;
    let currentBinding: CollaborationBinding | null = null;
    let unsubscribeLocal: (() => void) | null = null;
    let unsubscribeDocument: (() => void) | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let retryNotBefore = 0;
    let receivedSnapshot = false;
    let dirty = false;
    let inFlight = false;
    let stopped = false;

    const stopClosedSession = (reason: 'closed' | 'expired') => {
        if (stopped) return;
        stopped = true;
        dirty = false;
        if (flushTimer !== null) clearTimeout(flushTimer);
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        flushTimer = null;
        reconnectTimer = null;
        discardDocument();
        onClosed?.(reason);
    };

    const state = (): SessionSnapshot | null => doc ? {
        language: doc.getText('language').toString(),
        source: doc.getText('source').toString(),
    } : null;

    const emitState = () => {
        const value = state();
        if (value) onState?.(value);
    };

    const discardDocument = () => {
        const hadBinding = currentBinding !== null;
        unsubscribeLocal?.();
        unsubscribeDocument?.();
        unsubscribeLocal = null;
        unsubscribeDocument = null;
        doc = null;
        currentBinding = null;
        receivedSnapshot = false;
        dirty = false;
        inFlight = false;
        retryNotBefore = 0;
        if (hadBinding) onBinding?.(null);
    };

    const flush = () => {
        flushTimer = null;
        if (Date.now() < retryNotBefore) {
            scheduleFlush(0);
            return;
        }
        retryNotBefore = 0;
        if (!dirty || inFlight || !receivedSnapshot || socket?.readyState !== 1 || !doc) return;
        dirty = false;
        inFlight = true;
        socket.send(JSON.stringify({
            type: 'loro-update',
            update: bytesToBase64(doc.export({ mode: 'snapshot' })),
            actor: 'human',
            actorId,
        }));
    };

    const scheduleFlush = (delay = 250) => {
        if (flushTimer !== null) clearTimeout(flushTimer);
        const effectiveDelay = Math.max(delay, retryNotBefore - Date.now(), 0);
        flushTimer = setTimeout(flush, effectiveDelay);
    };

    const installDocument = (snapshot: Uint8Array) => {
        if (doc) {
            doc.import(snapshot);
            receivedSnapshot = true;
            emitState();
            if (dirty) scheduleFlush();
            return;
        }
        doc = LoroDoc.fromSnapshot(snapshot);
        receivedSnapshot = true;
        const ephemeral = new EphemeralStore();
        const undoManager = new UndoManager(doc, { excludeOriginPrefixes: ['remote'] });
        currentBinding = {
            doc,
            getText: (value) => value.getText('source'),
            ephemeral,
            undoManager,
            user: { name: 'Human', colorClassName: 'neolesk-collaborator' },
        };
        unsubscribeLocal = doc.subscribeLocalUpdates((update) => {
            void update;
            dirty = true;
            scheduleFlush();
        });
        unsubscribeDocument = doc.subscribe(emitState);
        onBinding?.(currentBinding);
        emitState();
    };

    const openSocket = () => {
        if (stopped || socket) return;
        const nextSocket = new WebSocketImpl(websocketUrl);
        socket = nextSocket;
        receivedSnapshot = false;
        onSocket?.(nextSocket);
        nextSocket.onopen = () => {
            reconnectAttempt = 0;
            nextSocket.send(JSON.stringify({
                type: 'presence',
                state: 'connected',
                actor: 'human',
                actorId,
            }));
        };
        nextSocket.onmessage = (event) => {
            const message = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (message.type === 'snapshot' && typeof message.update === 'string') {
                installDocument(base64ToBytes(message.update));
                if ((message.actor === 'agent' || message.actor === 'human') && Array.isArray(message.fields)) {
                    onActivity?.({
                        actor: message.actor,
                        actorId: typeof message.actorId === 'string' ? message.actorId : undefined,
                        fields: message.fields.filter((field): field is string => typeof field === 'string'),
                    });
                }
            } else if (message.type === 'activity'
                && (message.actor === 'agent' || message.actor === 'human')
                && Array.isArray(message.fields)) {
                onActivity?.({
                    actor: message.actor,
                    actorId: typeof message.actorId === 'string' ? message.actorId : undefined,
                    fields: message.fields.filter((field): field is string => typeof field === 'string'),
                });
            } else if (message.type === 'ack') {
                inFlight = false;
                if (dirty) scheduleFlush();
            } else if (message.type === 'error') {
                inFlight = false;
                onError?.(typeof message.message === 'string' ? message.message : 'Session update failed');
                const status = typeof message.status === 'number' ? message.status : 0;
                if (status >= 400 && status < 500 && status !== 429) {
                    discardDocument();
                    nextSocket.close();
                    return;
                }
                dirty = true;
                const retryAfterMs = status === 429 && typeof message.retryAfterMs === 'number'
                    ? Math.max(0, message.retryAfterMs)
                    : status === 429 ? 1_000 : 250;
                retryNotBefore = status === 429
                    ? Math.max(retryNotBefore, Date.now() + retryAfterMs)
                    : 0;
                scheduleFlush(retryAfterMs);
            } else if (message.type === 'closed') {
                stopClosedSession('closed');
                nextSocket.close();
            } else if (message.type === 'presence') {
                onPresence?.(message as unknown as SessionPresence);
            }
        };
        nextSocket.onclose = () => {
            if (socket === nextSocket) socket = null;
            receivedSnapshot = false;
            if (inFlight) dirty = true;
            inFlight = false;
            onPresence?.({ state: 'disconnected' });
            if (!stopped && reconnectTimer === null) {
                const delay = Math.min(30_000, reconnectBaseDelayMs * (2 ** reconnectAttempt));
                reconnectAttempt += 1;
                reconnectTimer = setTimeout(async () => {
                    reconnectTimer = null;
                    if (canReconnect) {
                        let available = true;
                        try {
                            available = await canReconnect();
                        } catch {
                            available = true;
                        }
                        if (!available) {
                            stopClosedSession('expired');
                            return;
                        }
                    }
                    openSocket();
                }, delay);
            }
        };
    };

    return {
        connect() {
            stopped = false;
            openSocket();
        },
        binding: () => currentBinding,
        participantId: () => actorId,
        disconnect() {
            stopped = true;
            if (flushTimer !== null) clearTimeout(flushTimer);
            if (reconnectTimer !== null) clearTimeout(reconnectTimer);
            flushTimer = null;
            reconnectTimer = null;
            discardDocument();
            socket?.close();
            socket = null;
        },
    };
};
