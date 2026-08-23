import { describe, expect, it, vi } from 'vitest';
import { SessionDocument } from './sessionDocument';
import { bytesToBase64 } from './base64';
import { createSessionClient, createSession } from './sessionClient';

class FakeWebSocket {
    static readonly OPEN = 1;
    readonly sent: string[] = [];
    readyState = FakeWebSocket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(readonly url: string) {}
    send(value: string) { this.sent.push(value); }
    close() { this.onclose?.(); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>); }
}

describe('browser session client', () => {
    it('binds CodeMirror to the shared source and sends local Loro updates', () => {
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

        expect(socket?.sent.map((message) => JSON.parse(message))).toEqual([
            expect.objectContaining({ type: 'loro-update', actor: 'human', update: expect.any(String) }),
        ]);
        expect(states).toContainEqual({ language: 'd2', source: 'a -> b -> c' });
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
