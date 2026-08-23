import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionDocument } from './sessionDocument';
import { bytesToBase64 } from './base64';
import { createSessionAvailabilityProbe, createSessionClient, createSession } from './sessionClient';

class FakeWebSocket {
    static readonly OPEN = 1;
    readonly sent: string[] = [];
    readyState = FakeWebSocket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(readonly url: string) {}
    send(value: string) { this.sent.push(value); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>); }
}

describe('browser session client', () => {
    it('checks reconnect availability through the non-touching presence endpoint', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
        const available = createSessionAvailabilityProbe(
            'https://diagrams.example/',
            'a'.repeat(64),
            fetchImpl as typeof fetch,
        );

        await expect(available()).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledWith(
            `https://diagrams.example/api/sessions/${'a'.repeat(64)}/presence`,
            expect.objectContaining({ headers: { accept: 'application/json' } }),
        );
    });

    afterEach(() => vi.useRealTimers());

    it('binds CodeMirror and batches normal typing into acknowledged snapshots', async () => {
        vi.useFakeTimers();
        const initial = SessionDocument.create({ language: 'd2', source: 'a -> b' });
        const states: unknown[] = [];
        let socket: FakeWebSocket | undefined;
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            onState: (state) => states.push(state),
            onSocket: (next) => { socket = next as unknown as FakeWebSocket; },
        });

        client.connect();
        socket?.receive({ type: 'snapshot', update: bytesToBase64(initial.exportSnapshot()) });
        const binding = client.binding();
        expect(binding?.getText(binding.doc).toString()).toBe('a -> b');

        binding?.getText(binding.doc).update('a -> b -> c');
        binding?.doc.commit();
        binding?.getText(binding.doc).insert(binding.getText(binding.doc).length, ' -> d');
        binding?.doc.commit();

        expect(socket?.sent).toEqual([]);
        await vi.advanceTimersByTimeAsync(300);

        expect(socket?.sent.map((message) => JSON.parse(message))).toEqual([
            expect.objectContaining({ type: 'loro-update', actor: 'human', update: expect.any(String) }),
        ]);
        socket?.receive({ type: 'ack' });
        expect(states).toContainEqual({ language: 'd2', source: 'a -> b -> c -> d' });
    });

    it('reconnects, merges the fresh server snapshot, and resends offline edits', async () => {
        vi.useFakeTimers();
        const initial = SessionDocument.create({ language: 'd2', source: 'a' });
        const sockets: FakeWebSocket[] = [];
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            reconnectBaseDelayMs: 10,
            onSocket: (socket) => sockets.push(socket as unknown as FakeWebSocket),
        });

        client.connect();
        sockets[0].receive({ type: 'snapshot', update: bytesToBase64(initial.exportSnapshot()) });
        const binding = client.binding();
        binding?.getText(binding.doc).insert(1, ' local');
        binding?.doc.commit();
        sockets[0].close();
        binding?.getText(binding.doc).insert(binding.getText(binding.doc).length, ' offline');
        binding?.doc.commit();

        await vi.advanceTimersByTimeAsync(10);
        expect(sockets).toHaveLength(2);
        sockets[1].receive({ type: 'snapshot', update: bytesToBase64(initial.exportSnapshot()) });
        await vi.advanceTimersByTimeAsync(300);

        const resent = sockets[1].sent.map((message) => JSON.parse(message));
        expect(resent).toContainEqual(expect.objectContaining({ type: 'loro-update' }));
        const update = resent.find((message) => message.type === 'loro-update').update;
        const replica = SessionDocument.fromLoroUpdate(initial.exportSnapshot());
        replica.importUpdate(Uint8Array.from(atob(update), (character) => character.charCodeAt(0)), { actor: 'human', actorId: 'test' });
        expect(replica.sharedState().source).toBe('a local offline');
    });

    it('surfaces agent activity carried with convergent snapshots', () => {
        const initial = SessionDocument.create({ language: 'd2', source: 'a' });
        const activity = vi.fn();
        let socket: FakeWebSocket | undefined;
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            onActivity: activity,
            onSocket: (next) => { socket = next as unknown as FakeWebSocket; },
        });
        client.connect();
        socket?.receive({
            type: 'snapshot',
            update: bytesToBase64(initial.exportSnapshot()),
            actor: 'agent',
            actorId: 'mcp',
            fields: ['source'],
        });

        expect(activity).toHaveBeenCalledWith({ actor: 'agent', actorId: 'mcp', fields: ['source'] });
    });

    it('keeps agent presence lifecycle separate from agent change activity', () => {
        const presence = vi.fn();
        const activity = vi.fn();
        let socket: FakeWebSocket | undefined;
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            onPresence: presence,
            onActivity: activity,
            onSocket: (next) => { socket = next as unknown as FakeWebSocket; },
        });
        client.connect();
        socket?.receive({ type: 'presence', state: 'connected', actor: 'agent', actorId: 'mcp' });
        socket?.receive({ type: 'activity', actor: 'agent', actorId: 'mcp', fields: ['view'] });
        socket?.receive({ type: 'presence', state: 'disconnected', actor: 'agent', actorId: 'mcp' });

        expect(presence.mock.calls.map(([event]) => event)).toEqual([
            { type: 'presence', state: 'connected', actor: 'agent', actorId: 'mcp' },
            { type: 'presence', state: 'disconnected', actor: 'agent', actorId: 'mcp' },
        ]);
        expect(activity).toHaveBeenCalledWith({ actor: 'agent', actorId: 'mcp', fields: ['view'] });
    });

    it('reuses one participant identity for the same session in one browser tab', () => {
        const values = new Map<string, string>();
        const participantStorage = {
            getItem: (key: string) => values.get(key) || null,
            setItem: (key: string, value: string) => { values.set(key, value); },
        };
        const clients = [1, 2].map(() => createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            participantStorage,
        }));

        expect(clients[0].participantId()).toBe(clients[1].participantId());
        expect(clients[0].participantId()).toMatch(/^browser-[0-9a-f]{16}$/);
    });

    it('drops a permanently rejected local snapshot and reconnects from authority', async () => {
        vi.useFakeTimers();
        const initial = SessionDocument.create({ language: 'd2', source: 'valid' });
        const authoritative = SessionDocument.create({ language: 'd2', source: 'server' });
        const sockets: FakeWebSocket[] = [];
        const states: unknown[] = [];
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            reconnectBaseDelayMs: 10,
            onSocket: (socket) => sockets.push(socket as unknown as FakeWebSocket),
            onState: (state) => states.push(state),
        });
        client.connect();
        sockets[0].receive({ type: 'snapshot', update: bytesToBase64(initial.exportSnapshot()) });
        const binding = client.binding();
        binding?.getText(binding.doc).update('too large');
        binding?.doc.commit();
        await vi.advanceTimersByTimeAsync(300);
        sockets[0].receive({ type: 'error', status: 413, message: 'Document too large' });
        await vi.advanceTimersByTimeAsync(10);
        expect(sockets).toHaveLength(2);
        sockets[1].receive({ type: 'snapshot', update: bytesToBase64(authoritative.exportSnapshot()) });
        await vi.advanceTimersByTimeAsync(300);

        expect(states[states.length - 1]).toEqual({ language: 'd2', source: 'server' });
        expect(sockets[1].sent.filter((message) => JSON.parse(message).type === 'loro-update')).toEqual([]);
    });

    it('honors retry-after and stops reconnecting when the session is closed', async () => {
        vi.useFakeTimers();
        const initial = SessionDocument.create({ language: 'd2', source: 'a' });
        const sockets: FakeWebSocket[] = [];
        const closed = vi.fn();
        const bindings: unknown[] = [];
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            reconnectBaseDelayMs: 10,
            onSocket: (socket) => sockets.push(socket as unknown as FakeWebSocket),
            onClosed: closed,
            onBinding: (binding) => bindings.push(binding),
        });
        client.connect();
        sockets[0].receive({ type: 'snapshot', update: bytesToBase64(initial.exportSnapshot()) });
        const binding = client.binding();
        binding?.getText(binding.doc).update('b');
        binding?.doc.commit();
        await vi.advanceTimersByTimeAsync(300);
        sockets[0].receive({ type: 'error', status: 429, retryAfterMs: 2_500, message: 'Slow down' });
        binding?.getText(binding.doc).update('c');
        binding?.doc.commit();
        await vi.advanceTimersByTimeAsync(250);
        expect(sockets[0].sent).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2_249);
        expect(sockets[0].sent).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets[0].sent).toHaveLength(2);

        sockets[0].receive({ type: 'closed' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(closed).toHaveBeenCalledOnce();
        expect(sockets).toHaveLength(1);
        expect(client.binding()).toBeNull();
        expect(bindings[bindings.length - 1]).toBeNull();
    });

    it('stops reconnecting when a previously live session has expired', async () => {
        vi.useFakeTimers();
        const initial = SessionDocument.create({ language: 'd2', source: 'retained' });
        const sockets: FakeWebSocket[] = [];
        const closed = vi.fn();
        const canReconnect = vi.fn(async () => false);
        const client = createSessionClient({
            websocketUrl: 'wss://diagrams.example/api/sessions/id/connect',
            WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
            reconnectBaseDelayMs: 10,
            canReconnect,
            onClosed: closed,
            onSocket: (socket) => sockets.push(socket as unknown as FakeWebSocket),
        });
        client.connect();
        sockets[0].receive({ type: 'snapshot', update: bytesToBase64(initial.exportSnapshot()) });

        sockets[0].close();
        await vi.advanceTimersByTimeAsync(10);

        expect(canReconnect).toHaveBeenCalledOnce();
        expect(sockets).toHaveLength(1);
        expect(client.binding()).toBeNull();
        expect(closed).toHaveBeenCalledWith('expired');
    });

    it('creates a session through the discovered backend', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            id: 'a'.repeat(64),
            sessionUrl: `https://diagrams.example/s/${'a'.repeat(64)}`,
            websocketUrl: `wss://diagrams.example/api/sessions/${'a'.repeat(64)}/connect`,
            mcpUrl: `https://diagrams.example/mcp/${'a'.repeat(64)}`,
        }), { status: 201, headers: { 'content-type': 'application/json' } }));

        const session = await createSession('https://diagrams.example', { language: 'd2', source: 'a -> b' }, fetchImpl as typeof fetch);

        expect(session.id).toHaveLength(64);
        expect(fetchImpl).toHaveBeenCalledWith('https://diagrams.example/api/sessions', expect.objectContaining({ method: 'POST' }));
    });
});
