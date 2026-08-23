import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
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

    it('rejects a document before its serialized state crosses the size cap', () => {
        const session = SessionDocument.create(initial, { maxDocumentBytes: 512 });

        expect(() => session.replace({ source: 'x'.repeat(2048) }, { actor: 'agent', actorId: 'codex' }))
            .toThrow(SessionLimitError);
        expect(session.sharedState()).toEqual(initial);
    });
});
