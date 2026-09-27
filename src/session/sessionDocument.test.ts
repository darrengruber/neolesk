import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt/bundler';
import {
    SessionDocument,
    SessionLimitError,
    type SessionSnapshot,
} from './sessionDocument';

const initial: SessionSnapshot = {
    language: 'plantuml',
    source: '@startuml\nAlice -> Bob\n@enduml',
};

describe('SessionDocument', () => {
    it('shares only source and language through Loro', () => {
        const session = SessionDocument.create(initial);

        session.setViewSettings('human', { zoom: 1.5, panel: 'preview', theme: 'dark' });
        session.setRendererOptions('agent', { layout: 'elk' });

        expect(session.sharedState()).toEqual(initial);
        expect(session.viewSettings('human')).toEqual({ zoom: 1.5, panel: 'preview', theme: 'dark' });
        expect(session.rendererOptions('agent')).toEqual({ layout: 'elk' });

        const replica = SessionDocument.fromLoroUpdate(session.exportSnapshot());
        expect(replica.sharedState()).toEqual(initial);
        expect(replica.viewSettings('human')).toEqual({});
        expect(replica.rendererOptions('agent')).toEqual({});
        expect(LoroDoc.fromSnapshot(session.exportSnapshot()).toJSON()).toEqual({
            language: 'plantuml',
            source: initial.source,
        });
    });

    // An explicit timeout keeps a slow runner failing on the assertion, not on
    // Vitest's 5 s default.
    it('bounds the text diff so a large rewrite cannot hold the cell', { timeout: 30_000 }, () => {
        const session = SessionDocument.create({ language: 'svgbob', source: '-->' });
        const large = 'x'.repeat(300_000);
        const startedAt = performance.now();

        session.replace({ source: large }, { actor: 'agent', actorId: 'mcp' });

        // Unbounded, Myers' diff took over 70 s here and over 140 s inside workerd.
        // Preparing the undo through Loro's UndoManager then took another 1.7 s.
        // The write now costs the 250 ms diff budget plus a few milliseconds.
        expect(performance.now() - startedAt).toBeLessThan(1_500);
        expect(session.sharedState().source).toBe(large);
        expect(session.undoLastAgentWrite()).toBe(true);
        expect(session.sharedState().source).toBe('-->');
    });

    it('undoes a large rewrite while preserving a later human edit', { timeout: 30_000 }, () => {
        const session = SessionDocument.create({ language: 'svgbob', source: '-->' });
        session.replace({ source: 'x'.repeat(300_000) }, { actor: 'agent', actorId: 'mcp' });

        const human = LoroDoc.fromSnapshot(session.exportSnapshot());
        human.getText('source').insert(human.getText('source').length, ' HUMAN');
        human.commit({ origin: 'human' });
        session.importUpdate(human.export({ mode: 'snapshot' }), { actor: 'human', actorId: 'browser' });

        expect(session.undoLastAgentWrite()).toBe(true);
        expect(session.sharedState().source).toBe('--> HUMAN');
    });

    it('records agent writes and restores the previous shared document', () => {
        const session = SessionDocument.create(initial);

        session.replace({ source: '@startuml\nBob -> Alice\n@enduml' }, { actor: 'agent', actorId: 'codex' });

        expect(session.sharedState().source).toContain('Bob -> Alice');
        expect(session.history()).toEqual([
            expect.objectContaining({ actor: 'agent', actorId: 'codex', fields: ['source'] }),
        ]);

        expect(session.undoLastAgentWrite()).toBe(true);
        expect(session.sharedState()).toEqual(initial);
    });

    it('undoes the latest agent operation while preserving later human CRDT edits', () => {
        const session = SessionDocument.create({ language: 'd2', source: 'a' });
        session.replace({ source: 'a -> b' }, { actor: 'agent', actorId: 'codex' });

        const human = LoroDoc.fromSnapshot(session.exportSnapshot());
        human.getText('source').insert(human.getText('source').length, ' HUMAN');
        human.commit({ origin: 'human' });
        session.importUpdate(human.export({ mode: 'snapshot' }), { actor: 'human', actorId: 'browser' });

        expect(session.undoLastAgentWrite()).toBe(true);
        expect(session.sharedState().source).toBe('a HUMAN');

        const connectedReplica = LoroDoc.fromSnapshot(human.export({ mode: 'snapshot' }));
        connectedReplica.import(session.exportSnapshot());
        expect(connectedReplica.getText('source').toString()).toBe('a HUMAN');
    });

    it('bounds persisted audit and undo data inside the session size cap', () => {
        const session = SessionDocument.create({ language: 'd2', source: 'a' }, { maxDocumentBytes: 64 * 1024 });
        for (let index = 0; index < 200; index += 1) {
            session.replace({ source: `a${index}` }, { actor: 'agent', actorId: 'codex' }, index);
        }

        const persisted = session.exportPersisted();
        const bytes = persisted.snapshot.byteLength + persisted.audit.reduce(
            (total, entry) => total + (entry.undo?.byteLength || 0) + JSON.stringify({ ...entry, undo: undefined }).length,
            0,
        );
        expect(bytes).toBeLessThanOrEqual(64 * 1024);
        expect(session.history().length).toBeLessThan(200);
        expect(session.undoLastAgentWrite()).toBe(true);
    });

    it('rejects a document before its serialized state crosses the size cap', () => {
        const session = SessionDocument.create(initial, { maxDocumentBytes: 512 });

        expect(() => session.replace({ source: 'x'.repeat(2048) }, { actor: 'agent', actorId: 'codex' }))
            .toThrow(SessionLimitError);
        expect(session.sharedState()).toEqual(initial);
    });
});
