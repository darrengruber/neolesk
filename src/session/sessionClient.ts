import { EphemeralStore, LoroDoc, UndoManager } from 'loro-crdt';
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

export const createSession = async (
    backendUrl: string,
    initial: SessionSnapshot,
    fetchImpl: typeof fetch = fetch,
): Promise<SessionLinks> => {
    const response = await fetchImpl(`${backendUrl.replace(/\/$/, '')}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initial),
    });
    if (!response.ok) throw new Error((await response.text()) || `Could not create session (HTTP ${response.status})`);
    return response.json() as Promise<SessionLinks>;
};

export const getSessionIdFromPath = (pathname: string): string | null => {
    const match = pathname.match(/^\/s\/([0-9a-f]{64})\/?$/i);
    return match?.[1] || null;
};

const participantId = (): string => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `browser-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export const createSessionClient = ({
    websocketUrl,
    WebSocketImpl = WebSocket,
    onState,
    onBinding,
    onPresence,
    onSocket,
}: {
    websocketUrl: string;
    WebSocketImpl?: typeof WebSocket;
    onState?: (state: SessionSnapshot) => void;
    onBinding?: (binding: CollaborationBinding) => void;
    onPresence?: (presence: SessionPresence) => void;
    onSocket?: (socket: WebSocket) => void;
}) => {
    const actorId = participantId();
    let socket: WebSocket | null = null;
    let doc: LoroDoc | null = null;
    let currentBinding: CollaborationBinding | null = null;
    let unsubscribeLocal: (() => void) | null = null;
    let unsubscribeDocument: (() => void) | null = null;

    const state = (): SessionSnapshot | null => doc ? {
        language: doc.getText('language').toString(),
        source: doc.getText('source').toString(),
    } : null;

    const emitState = () => {
        const value = state();
        if (value) onState?.(value);
    };

    const installDocument = (snapshot: Uint8Array) => {
        if (doc) {
            doc.import(snapshot);
            emitState();
            return;
        }
        doc = LoroDoc.fromSnapshot(snapshot);
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
            if (socket?.readyState !== 1) return;
            socket.send(JSON.stringify({
                type: 'loro-update',
                update: bytesToBase64(update),
                actor: 'human',
                actorId,
            }));
        });
        unsubscribeDocument = doc.subscribe(emitState);
        onBinding?.(currentBinding);
        emitState();
    };

    return {
        connect() {
            if (socket) return;
            socket = new WebSocketImpl(websocketUrl);
            onSocket?.(socket);
            socket.onopen = () => socket?.send(JSON.stringify({
                type: 'presence',
                state: 'connected',
                actor: 'human',
                actorId,
            }));
            socket.onmessage = (event) => {
                const message = JSON.parse(String(event.data)) as Record<string, unknown>;
                if (message.type === 'snapshot' && typeof message.update === 'string') {
                    installDocument(base64ToBytes(message.update));
                } else if (message.type === 'presence') {
                    onPresence?.(message as unknown as SessionPresence);
                }
            };
            socket.onclose = () => onPresence?.({ state: 'disconnected' });
        },
        binding: () => currentBinding,
        disconnect() {
            unsubscribeLocal?.();
            unsubscribeDocument?.();
            socket?.close();
            socket = null;
            doc = null;
            currentBinding = null;
        },
    };
};
