import { describe, expect, it, vi } from 'vitest';
import type { SessionCellStorage } from '../session/sessionCell';
import { SessionCell } from './index';

class MemoryStorage implements SessionCellStorage {
    private readonly values = new Map<string, unknown>();
    async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
    async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
    async deleteAll(): Promise<void> { this.values.clear(); }
    async setAlarm(): Promise<void> { /* test clock has no scheduler */ }
}

class FakeSocket {
    readonly sent: string[] = [];
    closed = false;
    send(message: string) { this.sent.push(message); }
    close() { this.closed = true; }
}

const createHarness = (socketCount = 1) => {
    const socket = new FakeSocket();
    const sockets = Array.from({ length: socketCount }, () => socket as unknown as WebSocket);
    const state = {
        storage: new MemoryStorage(),
        acceptWebSocket: vi.fn(),
        getWebSockets: () => sockets,
    };
    const cell = new SessionCell(state, {
        ASSETS: { fetch: async () => new Response('asset') },
        SESSION_CELL: {} as never,
        KROKI_ORIGIN: 'http://kroki.internal/',
    });
    return { cell, socket, state };
};

describe('session Worker WebSocket ingress', () => {
    it('rejects oversized frames before decoding or parsing them', async () => {
        const { cell, socket } = createHarness();

        await cell.webSocketMessage(socket as unknown as WebSocket, 'x'.repeat(512 * 1024 + 1));

        expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({ type: 'error', status: 413 }));
        expect(socket.closed).toBe(true);
    });

    it('binds one validated browser identity and never accepts an agent claim', async () => {
        const { cell, socket } = createHarness();
        await cell.fetch(new Request('https://session.internal/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));

        await cell.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({
            type: 'presence', state: 'connected', actor: 'agent', actorId: 'browser-0123456789abcdef',
        }));

        expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual(expect.objectContaining({
            type: 'presence', state: 'connected', actor: 'human', actorId: 'browser-0123456789abcdef',
        }));

        await cell.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({
            type: 'presence', state: 'connected', actor: 'human', actorId: 'browser-fedcba9876543210',
        }));
        expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual(expect.objectContaining({ status: 409 }));
    });

    it('requires presence before accepting CRDT updates', async () => {
        const { cell, socket } = createHarness();

        await cell.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({
            type: 'loro-update', update: 'e30=', actorId: 'browser-0123456789abcdef',
        }));

        expect(JSON.parse(socket.sent[0])).toEqual(expect.objectContaining({
            type: 'error', status: 400, message: expect.stringContaining('Presence required'),
        }));
    });

    it('closes a socket after repeated malformed protocol messages', async () => {
        const { cell, socket } = createHarness();

        for (let attempt = 0; attempt < 3; attempt += 1) {
            await cell.webSocketMessage(socket as unknown as WebSocket, '{');
        }

        expect(socket.closed).toBe(true);
    });

    it('rate-limits presence broadcasts on each socket', async () => {
        const { cell, socket } = createHarness();
        await cell.fetch(new Request('https://session.internal/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        const presence = (state: 'connected' | 'disconnected') => cell.webSocketMessage(
            socket as unknown as WebSocket,
            JSON.stringify({ type: 'presence', state, actorId: 'browser-0123456789abcdef' }),
        );
        for (let index = 0; index < 5; index += 1) {
            await presence('connected');
            await presence('disconnected');
        }

        await presence('connected');

        expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual(expect.objectContaining({ status: 429 }));
    });

    it('rejects WebSocket upgrades above the per-session connection cap', async () => {
        const { cell, state } = createHarness(32);
        await cell.fetch(new Request('https://session.internal/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));

        const response = await cell.fetch(new Request('https://session.internal/connect', {
            headers: { upgrade: 'websocket' },
        }));

        expect(response.status).toBe(429);
        expect(state.acceptWebSocket).not.toHaveBeenCalled();
    });
});
