import { LoroDoc, UndoManager, type Frontiers } from 'loro-crdt/bundler';

export interface SessionSnapshot {
    language: string;
    source: string;
}

export interface SessionViewSettings {
    panel?: 'code' | 'preview' | 'examples' | 'settings';
    sidebar?: 'examples' | 'syntax';
    theme?: 'auto' | 'light' | 'dark';
    zoom?: number;
    splitPercent?: number;
    scrollTop?: number;
    scrollLeft?: number;
    previewScrollTop?: number;
    previewScrollLeft?: number;
}

export interface SessionWriteActor {
    actor: 'human' | 'agent';
    actorId: string;
}

export interface SessionHistoryEntry extends SessionWriteActor {
    at: number;
    fields: Array<keyof SessionSnapshot>;
    undone?: boolean;
}

export interface StoredHistoryEntry extends SessionHistoryEntry {
    undo?: Uint8Array;
    before?: Frontiers;
    after?: Frontiers;
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
    static readonly MAX_HISTORY_ENTRIES = 64;

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
            undo: entry.undo ? new Uint8Array(entry.undo) : undefined,
            before: entry.before?.map((frontier) => ({ ...frontier })),
            after: entry.after?.map((frontier) => ({ ...frontier })),
        })));
        session.trimAudit(persisted.snapshot);
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
    ): Array<keyof SessionSnapshot> {
        const fields = (['source', 'language'] as const).filter((field) => (
            changes[field] !== undefined && changes[field] !== this.sharedState()[field]
        ));
        if (fields.length === 0) return [];

        const before = this.exportSnapshot();
        const candidate = LoroDoc.fromSnapshot(before);
        const beforeFrontiers = candidate.frontiers();
        const undoManager = actor.actor === 'agent' ? new UndoManager(candidate, {}) : null;
        fields.forEach((field) => candidate.getText(field).update(changes[field] as string));
        candidate.commit({ origin: actor.actor, message: `${actor.actorId}: ${fields.join(', ')}` });
        const nextSnapshot = candidate.export({ mode: 'snapshot' });
        const afterFrontiers = candidate.frontiers();
        this.assertWithinLimit(nextSnapshot);

        let undo: Uint8Array | undefined;
        if (undoManager) {
            const afterVersion = candidate.version();
            if (!undoManager.undo()) throw new Error('Could not record an undo operation for the agent write');
            candidate.commit({ origin: 'session:prepare-undo' });
            undo = candidate.export({ mode: 'update', from: afterVersion });
        }

        const entry: StoredHistoryEntry = {
            ...actor,
            at,
            fields: [...fields],
            undo,
            ...(actor.actor === 'agent' ? { before: beforeFrontiers, after: afterFrontiers } : {}),
        };
        this.audit.push(entry);
        try {
            this.trimAudit(nextSnapshot, entry);
        } catch (error) {
            this.audit.pop();
            throw error;
        }
        this.document = LoroDoc.fromSnapshot(nextSnapshot);
        return fields;
    }

    importUpdate(update: Uint8Array, actor: SessionWriteActor, at = Date.now()): void {
        const before = this.exportSnapshot();
        const candidate = LoroDoc.fromSnapshot(before);
        candidate.import(update);
        candidate.commit({ origin: actor.actor, message: `${actor.actorId}: CRDT update` });
        const nextSnapshot = candidate.export({ mode: 'snapshot' });
        this.assertWithinLimit(nextSnapshot);
        const entry: StoredHistoryEntry = { ...actor, at, fields: ['source', 'language'] };
        this.audit.push(entry);
        try {
            this.trimAudit(nextSnapshot);
        } catch (error) {
            this.audit.pop();
            throw error;
        }
        this.document = candidate;
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
                undo: entry.undo ? new Uint8Array(entry.undo) : undefined,
                before: entry.before?.map((frontier) => ({ ...frontier })),
                after: entry.after?.map((frontier) => ({ ...frontier })),
            })),
        };
    }

    history(): SessionHistoryEntry[] {
        return this.audit.map(({
            undo: _undo,
            before: _before,
            after: _after,
            ...entry
        }) => ({ ...entry, fields: [...entry.fields] }));
    }

    latestAgentUndoUpdate(): Uint8Array | null {
        for (let index = this.audit.length - 1; index >= 0; index -= 1) {
            const entry = this.audit[index];
            if (entry.actor === 'agent' && !entry.undone && entry.undo) return new Uint8Array(entry.undo);
        }
        return null;
    }

    undoLastAgentWrite(undoUpdate?: Uint8Array): boolean {
        let latest: StoredHistoryEntry | undefined;
        for (let index = this.audit.length - 1; index >= 0; index -= 1) {
            const entry = this.audit[index];
            if (entry.actor === 'agent' && !entry.undone && entry.undo) {
                latest = entry;
                break;
            }
        }
        const undo = undoUpdate || latest?.undo;
        if (!undo) return false;
        const candidate = LoroDoc.fromSnapshot(this.exportSnapshot());
        if (latest?.before && latest.after) {
            candidate.applyDiff(candidate.diff(latest.after, latest.before, false));
        } else {
            candidate.import(undo);
        }
        candidate.commit({ origin: 'human', message: 'Undo latest agent write' });
        const nextSnapshot = candidate.export({ mode: 'snapshot' });
        if (latest) {
            latest.undone = true;
            latest.undo = undefined;
        }
        this.trimAudit(nextSnapshot);
        this.document = candidate;
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

    private persistedBytes(snapshot: Uint8Array): number {
        return snapshot.byteLength + this.audit.reduce((total, entry) => (
            total
            + (entry.undo?.byteLength || 0)
            + JSON.stringify({ ...entry, undo: undefined }).length
        ), 0);
    }

    private trimAudit(snapshot: Uint8Array, protectedEntry?: StoredHistoryEntry): void {
        while (this.audit.length > SessionDocument.MAX_HISTORY_ENTRIES) {
            const withoutLiveUndo = this.audit.findIndex((entry) => !entry.undo || entry.undone);
            this.audit.splice(withoutLiveUndo >= 0 ? withoutLiveUndo : 0, 1);
        }
        while (this.persistedBytes(snapshot) > this.maxDocumentBytes && this.audit.length > 0) {
            let removable = this.audit.findIndex((entry) => (
                entry !== protectedEntry && (!entry.undo || entry.undone)
            ));
            if (removable < 0) removable = this.audit.findIndex((entry) => entry !== protectedEntry);
            if (removable < 0) break;
            this.audit.splice(removable, 1);
        }
        const total = this.persistedBytes(snapshot);
        if (total > this.maxDocumentBytes) throw new SessionLimitError(total, this.maxDocumentBytes);
    }
}
