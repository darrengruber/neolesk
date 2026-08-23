import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionCell, type SessionCellStorage } from './sessionCell';

class MemoryStorage implements SessionCellStorage {
    readonly values = new Map<string, unknown>();
    alarm: number | null = null;

    async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
    async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
    async deleteAll(): Promise<void> { this.values.clear(); }
    async setAlarm(at: number): Promise<void> { this.alarm = at; }
}

describe('session cell HTTP surface', () => {
    let storage: MemoryStorage;
    let now: number;

    beforeEach(() => {
        storage = new MemoryStorage();
        now = Date.parse('2026-08-23T14:00:00Z');
    });

    it('initializes, mutates, and undoes an agent edit through fetch', async () => {
        const cell = createSessionCell(storage, { now: () => now });

        const initialized = await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'plantuml', source: '@startuml\n@enduml' }),
        }));
        expect(initialized.status).toBe(201);

        const changed = await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST',
            body: JSON.stringify({ source: '@startuml\nAlice -> Bob\n@enduml', actor: 'agent', actorId: 'codex' }),
        }));
        expect(changed.status).toBe(200);
        expect(await changed.json()).toEqual(expect.objectContaining({
            language: 'plantuml',
            source: expect.stringContaining('Alice -> Bob'),
        }));

        const undo = await cell.fetch(new Request('https://cell/undo', { method: 'POST' }));
        expect(undo.status).toBe(200);
        expect(await undo.json()).toEqual(expect.objectContaining({ source: '@startuml\n@enduml' }));
    });

    it('keeps view and renderer settings participant-local', async () => {
        const cell = createSessionCell(storage, { now: () => now });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        await cell.fetch(new Request('https://cell/view/human', {
            method: 'PUT',
            body: JSON.stringify({ zoom: 2, panel: 'preview' }),
        }));
        await cell.fetch(new Request('https://cell/renderer-options/agent', {
            method: 'PUT',
            body: JSON.stringify({ layout: 'elk' }),
        }));

        expect(await (await cell.fetch(new Request('https://cell/view/human'))).json()).toEqual({ zoom: 2, panel: 'preview' });
        expect(await (await cell.fetch(new Request('https://cell/view/agent'))).json()).toEqual({});
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json()).toEqual({ layout: 'elk' });
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({
            language: 'd2',
            source: 'a -> b',
        }));
    });

    it('rate-limits writes and schedules idle expiration', async () => {
        const cell = createSessionCell(storage, {
            now: () => now,
            maxWritesPerMinute: 2,
            idleTtlMs: 1_000,
        });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));

        for (const source of ['b', 'c']) {
            expect((await cell.fetch(new Request('https://cell/mutate', {
                method: 'POST',
                body: JSON.stringify({ source, actor: 'agent', actorId: 'codex' }),
            }))).status).toBe(200);
        }
        expect((await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST',
            body: JSON.stringify({ source: 'd', actor: 'agent', actorId: 'codex' }),
        }))).status).toBe(429);
        expect(storage.alarm).toBe(now + 1_000);
    });
});
