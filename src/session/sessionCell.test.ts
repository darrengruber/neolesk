import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoroDoc } from 'loro-crdt/bundler';
import { bytesToBase64 } from './base64';
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

    it('undoes consecutive agent diagram-source writes through persisted cell state', async () => {
        const cell = createSessionCell(storage, { now: () => now });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'graphviz', source: 'digraph { AAAA }' }),
        }));
        for (const source of ['digraph { BBBB }', 'digraph { CCCC }']) {
            now += 1;
            await cell.fetch(new Request('https://cell/mutate', {
                method: 'POST', body: JSON.stringify({ source, actor: 'agent', actorId: 'mcp' }),
            }));
        }
        const state = await (await cell.fetch(new Request('https://cell/state'))).json() as {
            history: Array<Record<string, unknown>>;
        };
        const latestHistory = state.history[state.history.length - 1];
        expect(latestHistory).not.toHaveProperty('before');
        expect(latestHistory).not.toHaveProperty('after');

        expect(await (await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).json())
            .toEqual(expect.objectContaining({ source: 'digraph { BBBB }' }));
        expect(await (await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).json())
            .toEqual(expect.objectContaining({ source: 'digraph { AAAA }' }));
    });

    it('preserves a later human edit while undoing consecutive agent writes', async () => {
        const cell = createSessionCell(storage, { now: () => now });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'AAAA' }),
        }));
        for (const source of ['BBBB', 'CCCC']) {
            now += 1;
            await cell.fetch(new Request('https://cell/mutate', {
                method: 'POST', body: JSON.stringify({ source, actor: 'agent', actorId: 'mcp' }),
            }));
        }

        const snapshot = new Uint8Array(await (await cell.fetch(new Request('https://cell/snapshot'))).arrayBuffer());
        const human = LoroDoc.fromSnapshot(snapshot);
        human.getText('source').insert(human.getText('source').length, ' HUMAN');
        human.commit({ origin: 'human' });
        await cell.fetch(new Request('https://cell/crdt', {
            method: 'POST', body: JSON.stringify({
                actorId: 'browser', update: bytesToBase64(human.export({ mode: 'snapshot' })),
            }),
        }));

        expect(await (await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).json())
            .toEqual(expect.objectContaining({ source: 'BBBB HUMAN' }));
        expect(await (await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).json())
            .toEqual(expect.objectContaining({ source: 'AAAA HUMAN' }));
    });

    it('reuses the capped document audit instead of duplicating inverse snapshots', async () => {
        const cell = createSessionCell(storage, { now: () => now });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST', body: JSON.stringify({ source: 'a'.repeat(64_000), actor: 'agent', actorId: 'mcp' }),
        }));

        const unifiedUndo = storage.values.get('agent-undo') as Array<Record<string, unknown>>;
        expect(unifiedUndo).toEqual([expect.objectContaining({ kind: 'document' })]);
        expect(unifiedUndo[0]).not.toHaveProperty('undo');
    });

    it('undoes agent view, renderer option, and document writes in exact reverse order', async () => {
        const cell = createSessionCell(storage, { now: () => now });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST', body: JSON.stringify({ source: 'a -> b', actor: 'agent', actorId: 'mcp' }),
        }));
        now += 1;
        await cell.fetch(new Request('https://cell/renderer-options/agent', {
            method: 'PUT', body: JSON.stringify({ layout: 'elk' }),
        }));
        now += 1;
        await cell.fetch(new Request('https://cell/view/agent', {
            method: 'PUT', body: JSON.stringify({ panel: 'preview', theme: 'dark' }),
        }));

        expect((await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).status).toBe(200);
        expect(await (await cell.fetch(new Request('https://cell/view/agent'))).json()).toEqual({});
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json()).toEqual({ layout: 'elk' });
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({ source: 'a -> b' }));

        expect((await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).status).toBe(200);
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json()).toEqual({});
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({ source: 'a -> b' }));

        expect((await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).status).toBe(200);
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({ source: 'a' }));
    });

    it('keeps an agent document inverse after the bounded audit fills with human writes', async () => {
        const cell = createSessionCell(storage, { now: () => now, maxHumanWritesPerMinute: 200 });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST', body: JSON.stringify({ language: 'graphviz', actor: 'agent', actorId: 'mcp' }),
        }));
        for (let index = 0; index < 64; index += 1) {
            now += 1;
            await cell.fetch(new Request('https://cell/mutate', {
                method: 'POST', body: JSON.stringify({ source: `human-${index}`, actor: 'human', actorId: 'browser' }),
            }));
        }

        expect((await cell.fetch(new Request('https://cell/undo', { method: 'POST' }))).status).toBe(200);
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({
            language: 'd2', source: 'human-63',
        }));
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

    it('replaces renderer options and scopes them to the active language', async () => {
        const cell = createSessionCell(storage, {
            now: () => now,
            validateRendererOptions: (language, options) => {
                const supported = language === 'd2' ? ['layout'] : [];
                for (const key of Object.keys(options)) {
                    if (!supported.includes(key)) throw new Error(`Unsupported renderer option ${key}`);
                }
                return options;
            },
        });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        expect((await cell.fetch(new Request('https://cell/renderer-options/agent', {
            method: 'PUT', body: JSON.stringify({ layout: 'dagre' }),
        }))).status).toBe(200);
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json())
            .toEqual({ layout: 'dagre' });

        await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST',
            body: JSON.stringify({ language: 'plantuml', actor: 'agent', actorId: 'mcp' }),
        }));
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json()).toEqual({});
        expect((await cell.fetch(new Request('https://cell/renderer-options/agent', {
            method: 'PUT', body: JSON.stringify({}),
        }))).status).toBe(200);

        await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST', body: JSON.stringify({ language: 'd2', actor: 'agent', actorId: 'mcp' }),
        }));
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json())
            .toEqual({ layout: 'dagre' });
        await cell.fetch(new Request('https://cell/renderer-options/agent', {
            method: 'PUT', body: JSON.stringify({}),
        }));
        expect(await (await cell.fetch(new Request('https://cell/renderer-options/agent'))).json()).toEqual({});
    });

    it('normalizes participant view coordinates to the supported viewport bounds', async () => {
        const cell = createSessionCell(storage, { now: () => now });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));

        const response = await cell.fetch(new Request('https://cell/view/human', {
            method: 'PUT',
            body: JSON.stringify({ zoom: 99, splitPercent: -40, scrollTop: -1, scrollLeft: 12 }),
        }));

        expect(await response.json()).toEqual({ zoom: 4, splitPercent: 20, scrollTop: 0, scrollLeft: 12 });
    });

    it('rejects unsupported languages before they enter shared state', async () => {
        const validateLanguage = (language: string) => ['d2', 'plantuml'].includes(language);
        const cell = createSessionCell(storage, { now: () => now, validateLanguage });

        expect((await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'not-a-renderer', source: 'a' }),
        }))).status).toBe(400);

        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        expect((await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST',
            body: JSON.stringify({ language: 'not-a-renderer', actor: 'agent', actorId: 'codex' }),
        }))).status).toBe(400);
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({ language: 'd2' }));
    });

    it('rate-limits writes and schedules idle expiration', async () => {
        let cell = createSessionCell(storage, {
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
        cell = createSessionCell(storage, {
            now: () => now,
            maxWritesPerMinute: 2,
            idleTtlMs: 1_000,
        });
        expect((await cell.fetch(new Request('https://cell/mutate', {
            method: 'POST',
            body: JSON.stringify({ source: 'd', actor: 'agent', actorId: 'codex' }),
        }))).status).toBe(429);
        expect(storage.alarm).toBe(now + 1_000);
    });

    it('treats agent presence as session activity for idle expiration', async () => {
        const onChange = vi.fn();
        const cell = createSessionCell(storage, { now: () => now, idleTtlMs: 1_000, onChange });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        now += 800;

        expect((await cell.fetch(new Request('https://cell/presence', {
            method: 'POST', body: JSON.stringify({ actor: 'agent', actorId: 'mcp', state: 'connected' }),
        }))).status).toBe(204);
        expect(storage.alarm).toBe(now + 1_000);
        expect(onChange).toHaveBeenLastCalledWith({
            type: 'presence', actor: 'agent', actorId: 'mcp', state: 'connected', fields: [],
        });
    });

    it('does not refresh idle expiration when presence is only inspected', async () => {
        const cell = createSessionCell(storage, { now: () => now, idleTtlMs: 1_000 });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        const initialAlarm = storage.alarm;
        now += 800;

        expect((await cell.fetch(new Request('https://cell/presence'))).status).toBe(200);
        expect(storage.alarm).toBe(initialAlarm);
    });

    it('charges malformed CRDT updates before decoding them', async () => {
        const cell = createSessionCell(storage, { now: () => now, maxHumanWritesPerMinute: 1 });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        const malformed = () => cell.fetch(new Request('https://cell/crdt', {
            method: 'POST', body: JSON.stringify({ update: '***', actorId: 'browser' }),
        }));

        expect((await malformed()).status).toBe(400);
        const limited = await malformed();
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('60');
    });

    it('expires an explicit agent lease before considering the session idle', async () => {
        const onChange = vi.fn();
        const cell = createSessionCell(storage, {
            now: () => now, idleTtlMs: 1_000, agentLeaseMs: 100, onChange,
        });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        await cell.fetch(new Request('https://cell/presence', {
            method: 'POST', body: JSON.stringify({ actor: 'agent', actorId: 'mcp', state: 'connected' }),
        }));
        expect(storage.alarm).toBe(now + 100);

        now += 100;
        await cell.expire({ keepAlive: true });
        expect(await (await cell.fetch(new Request('https://cell/presence'))).json()).toEqual({
            type: 'presence', actor: 'agent', actorId: 'mcp', state: 'disconnected',
        });
        expect(onChange).toHaveBeenCalledWith({
            type: 'presence', actor: 'agent', actorId: 'mcp', state: 'disconnected', fields: [],
        });
        expect((await cell.fetch(new Request('https://cell/state'))).status).toBe(200);
    });

    it('rate-limits every mutation and bounds participant storage', async () => {
        const cell = createSessionCell(storage, {
            now: () => now,
            maxWritesPerMinute: 10,
            maxParticipants: 1,
        });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));

        expect((await cell.fetch(new Request('https://cell/view/human', {
            method: 'PUT', body: JSON.stringify({ panel: 'preview' }),
        }))).status).toBe(200);
        expect((await cell.fetch(new Request('https://cell/view/second', {
            method: 'PUT', body: JSON.stringify({ panel: 'code' }),
        }))).status).toBe(413);
        expect((await cell.fetch(new Request('https://cell/view/%2Fbad', {
            method: 'PUT', body: JSON.stringify({ panel: 'code' }),
        }))).status).toBe(400);

        const rateLimited = createSessionCell(new MemoryStorage(), {
            now: () => now,
            maxWritesPerMinute: 1,
        });
        await rateLimited.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a' }),
        }));
        expect((await rateLimited.fetch(new Request('https://cell/view/human', {
            method: 'PUT', body: JSON.stringify({ panel: 'preview' }),
        }))).status).toBe(200);
        expect((await rateLimited.fetch(new Request('https://cell/view/human', {
            method: 'PUT', body: JSON.stringify({ panel: 'code' }),
        }))).status).toBe(429);
    });

    it('renders and exports inside the cell with participant-local options', async () => {
        const render = vi.fn(async () => ({
            data: '<svg data-layout="elk"/>',
            diagnostics: [],
            provenance: { kind: 'local' as const, rendererId: 'd2-browser', rendererLabel: 'D2', options: { layout: 'elk' } },
        }));
        const exportBinary = vi.fn(async () => ({
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
        }));
        const cell = createSessionCell(storage, { now: () => now, render, exportBinary });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        await cell.fetch(new Request('https://cell/renderer-options/agent', {
            method: 'PUT', body: JSON.stringify({ layout: 'elk' }),
        }));

        const rendered = await cell.fetch(new Request('https://cell/render', {
            method: 'POST', body: JSON.stringify({ participantId: 'agent', format: 'svg' }),
        }));
        expect(await rendered.json()).toEqual(expect.objectContaining({ data: '<svg data-layout="elk"/>' }));
        expect(render).toHaveBeenCalledWith(expect.objectContaining({
            language: 'd2', source: 'a -> b', format: 'svg', options: { layout: 'elk' },
        }));

        const exported = await cell.fetch(new Request('https://cell/export', {
            method: 'POST', body: JSON.stringify({
                participantId: 'agent', format: 'png', rendererId: 'kroki-io', maxBytes: 1_024,
            }),
        }));
        expect(exported.headers.get('content-type')).toBe('image/png');
        expect(exported.headers.get('content-length')).toBe('3');
        expect(new Uint8Array(await exported.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        expect(exportBinary).toHaveBeenCalledWith(expect.objectContaining({
            options: { layout: 'elk' }, rendererId: 'kroki-io', maxBytes: 1_024,
        }));
    });

    it('bounds expensive renders and exports independently from writes', async () => {
        const render = vi.fn(async () => ({
            data: '<svg/>', diagnostics: [],
            provenance: { kind: 'local' as const, rendererId: 'd2-worker', rendererLabel: 'D2', options: {} },
        }));
        const exportBinary = vi.fn(async () => ({ data: new Uint8Array([1]), mimeType: 'image/png' }));
        const cell = createSessionCell(storage, {
            now: () => now, render, exportBinary,
            maxRendersPerMinute: 1, maxExportsPerMinute: 1,
        });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        const renderRequest = () => cell.fetch(new Request('https://cell/render', {
            method: 'POST', body: JSON.stringify({ participantId: 'agent', format: 'svg' }),
        }));
        const exportRequest = () => cell.fetch(new Request('https://cell/export', {
            method: 'POST', body: JSON.stringify({ participantId: 'agent', format: 'png', rendererId: 'neolesk' }),
        }));

        expect((await renderRequest()).status).toBe(200);
        expect((await renderRequest()).status).toBe(429);
        expect((await exportRequest()).status).toBe(200);
        expect((await exportRequest()).status).toBe(429);
        expect(render).toHaveBeenCalledOnce();
        expect(exportBinary).toHaveBeenCalledOnce();
    });

    it('rejects oversized bodies before parsing or mutating a session', async () => {
        const cell = createSessionCell(storage, { now: () => now, maxRequestBodyBytes: 64 });
        const response = await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'x'.repeat(128) }),
        }));

        expect(response.status).toBe(413);
        expect(storage.values.has('document')).toBe(false);
    });

    it('rejects concurrent render and export work above the configured bounds', async () => {
        let releaseRender = () => {};
        let releaseExport = () => {};
        const render = vi.fn(async () => {
            await new Promise<void>((resolve) => { releaseRender = resolve; });
            return {
                data: '<svg/>', diagnostics: [],
                provenance: { kind: 'local' as const, rendererId: 'd2-worker', rendererLabel: 'D2', options: {} },
            };
        });
        const exportBinary = vi.fn(async () => {
            await new Promise<void>((resolve) => { releaseExport = resolve; });
            return { data: new Uint8Array([1]), mimeType: 'image/png' };
        });
        const cell = createSessionCell(storage, {
            now: () => now, render, exportBinary,
            maxConcurrentRenders: 1, maxConcurrentExports: 1,
        });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        const renderRequest = () => cell.fetch(new Request('https://cell/render', {
            method: 'POST', body: JSON.stringify({ participantId: 'agent', format: 'svg' }),
        }));
        const exportRequest = () => cell.fetch(new Request('https://cell/export', {
            method: 'POST', body: JSON.stringify({ participantId: 'agent', format: 'png', rendererId: 'neolesk' }),
        }));

        const firstRender = renderRequest();
        await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
        expect((await renderRequest()).status).toBe(429);
        releaseRender();
        expect((await firstRender).status).toBe(200);

        const firstExport = exportRequest();
        await vi.waitFor(() => expect(exportBinary).toHaveBeenCalledOnce());
        expect((await exportRequest()).status).toBe(429);
        releaseExport();
        expect((await firstExport).status).toBe(200);
    });
});
