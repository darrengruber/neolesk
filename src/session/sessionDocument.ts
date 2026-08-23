import { LoroDoc } from 'loro-crdt';

export interface SessionSnapshot {
    language: string;
    source: string;
}

export interface SessionViewSettings {
    panel?: 'code' | 'preview' | 'examples' | 'settings';
    theme?: 'auto' | 'light' | 'dark';
    zoom?: number;
    scrollTop?: number;
    scrollLeft?: number;
}

export interface SessionWriteActor {
    actor: 'human' | 'agent';
    actorId: string;
}

export interface SessionHistoryEntry extends SessionWriteActor {
    at: number;
    fields: Array<keyof SessionSnapshot>;
}

interface StoredHistoryEntry extends SessionHistoryEntry {
    before: Uint8Array;
}

export interface PersistedSessionDocument {
    snapshot: Uint8Array;
    audit: StoredHistoryEntry[];
}

export class SessionLimitError extends Error {
    constructor(readonly actualBytes: number, readonly maxBytes: number) {
        super(`Session document is ${actualBytes} bytes; the limit is ${maxBytes} bytes`);
        this.name = 'SessionLimitError';
    }
}

export class SessionDocument {
    static readonly DEFAULT_MAX_DOCUMENT_BYTES = 256 * 1024;

    private document: LoroDoc;
    private readonly maxDocumentBytes: number;
    private readonly views = new Map<string, SessionViewSettings>();
    private readonly rendererOptionsByParticipant = new Map<string, Record<string, string>>();
    private readonly audit: StoredHistoryEntry[] = [];

    private constructor(document: LoroDoc, maxDocumentBytes: number) {
        this.document = document;
        this.maxDocumentBytes = maxDocumentBytes;
    }

    static create(
        initial: SessionSnapshot,
        options: { maxDocumentBytes?: number } = {},
    ): SessionDocument {
        const document = new LoroDoc();
        document.getText('source').insert(0, initial.source);
        document.getText('language').insert(0, initial.language);
        document.commit({ origin: 'session:create' });
        const session = new SessionDocument(
            document,
            options.maxDocumentBytes ?? SessionDocument.DEFAULT_MAX_DOCUMENT_BYTES,
        );
        session.assertWithinLimit(document.export({ mode: 'snapshot' }));
        return session;
    }

    static fromLoroUpdate(
        snapshot: Uint8Array,
        options: { maxDocumentBytes?: number } = {},
    ): SessionDocument {
        const maxDocumentBytes = options.maxDocumentBytes ?? SessionDocument.DEFAULT_MAX_DOCUMENT_BYTES;
        if (snapshot.byteLength > maxDocumentBytes) {
            throw new SessionLimitError(snapshot.byteLength, maxDocumentBytes);
        }
        return new SessionDocument(LoroDoc.fromSnapshot(snapshot), maxDocumentBytes);
    }

    static fromPersisted(
        persisted: PersistedSessionDocument,
        options: { maxDocumentBytes?: number } = {},
    ): SessionDocument {
        const session = SessionDocument.fromLoroUpdate(persisted.snapshot, options);
        session.audit.push(...persisted.audit.map((entry) => ({
            ...entry,
            fields: [...entry.fields],
            before: new Uint8Array(entry.before),
        })));
        return session;
    }

    sharedState(): SessionSnapshot {
        return {
            language: this.document.getText('language').toString(),
            source: this.document.getText('source').toString(),
        };
    }

    replace(
        changes: Partial<SessionSnapshot>,
        actor: SessionWriteActor,
        at = Date.now(),
    ): void {
        const fields = (['source', 'language'] as const).filter((field) => (
            changes[field] !== undefined && changes[field] !== this.sharedState()[field]
        ));
        if (fields.length === 0) return;

        const before = this.exportSnapshot();
        const candidate = LoroDoc.fromSnapshot(before);
        fields.forEach((field) => candidate.getText(field).update(changes[field] as string));
        candidate.commit({ origin: actor.actor, message: `${actor.actorId}: ${fields.join(', ')}` });
        this.assertWithinLimit(candidate.export({ mode: 'snapshot' }));

        this.document = candidate;
        this.audit.push({ ...actor, at, fields: [...fields], before });
    }

    importUpdate(update: Uint8Array, actor: SessionWriteActor, at = Date.now()): void {
        const before = this.exportSnapshot();
        const candidate = LoroDoc.fromSnapshot(before);
        candidate.import(update);
        candidate.commit({ origin: actor.actor, message: `${actor.actorId}: CRDT update` });
        this.assertWithinLimit(candidate.export({ mode: 'snapshot' }));
        this.document = candidate;
        this.audit.push({ ...actor, at, fields: ['source', 'language'], before });
    }

    exportSnapshot(): Uint8Array {
        return this.document.export({ mode: 'snapshot' });
    }

    exportPersisted(): PersistedSessionDocument {
        return {
            snapshot: this.exportSnapshot(),
            audit: this.audit.map((entry) => ({
                ...entry,
                fields: [...entry.fields],
                before: new Uint8Array(entry.before),
            })),
        };
    }

    history(): SessionHistoryEntry[] {
        return this.audit.map(({ before: _before, ...entry }) => ({ ...entry, fields: [...entry.fields] }));
    }

    undoLastAgentWrite(): boolean {
        const latest = this.audit[this.audit.length - 1];
        if (!latest || latest.actor !== 'agent') return false;
        this.document = LoroDoc.fromSnapshot(latest.before);
        this.audit.pop();
        return true;
    }

    setViewSettings(participantId: string, settings: SessionViewSettings): void {
        this.views.set(participantId, { ...this.views.get(participantId), ...settings });
    }

    viewSettings(participantId: string): SessionViewSettings {
        return { ...this.views.get(participantId) };
    }

    setRendererOptions(participantId: string, options: Record<string, string>): void {
        this.rendererOptionsByParticipant.set(participantId, {
            ...this.rendererOptionsByParticipant.get(participantId),
            ...options,
        });
    }

    rendererOptions(participantId: string): Record<string, string> {
        return { ...this.rendererOptionsByParticipant.get(participantId) };
    }

    private assertWithinLimit(snapshot: Uint8Array): void {
        if (snapshot.byteLength > this.maxDocumentBytes) {
            throw new SessionLimitError(snapshot.byteLength, this.maxDocumentBytes);
        }
    }
}
