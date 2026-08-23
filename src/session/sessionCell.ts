import {
    SessionDocument,
    SessionLimitError,
    type PersistedSessionDocument,
    type SessionSnapshot,
    type SessionViewSettings,
} from './sessionDocument';
import { base64ToBytes } from './base64';

export interface SessionCellStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(at: number): Promise<void>;
}

export interface SessionCellOptions {
    now?: () => number;
    maxDocumentBytes?: number;
    maxWritesPerMinute?: number;
    idleTtlMs?: number;
    onChange?: (message: SessionChangeMessage) => void;
}

export interface SessionChangeMessage {
    type: 'changed' | 'presence';
    state?: SessionSnapshot;
    actor?: 'human' | 'agent';
    actorId?: string;
}

const DOCUMENT_KEY = 'document';
const viewKey = (participantId: string) => `view:${participantId}`;
const optionsKey = (participantId: string) => `renderer-options:${participantId}`;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const json = (value: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(
    JSON.stringify(value),
    { status, headers: { ...JSON_HEADERS, ...headers } },
);

const parseObject = async (request: Request): Promise<Record<string, unknown>> => {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
    return parsed as Record<string, unknown>;
};

const cleanViewSettings = (input: Record<string, unknown>): SessionViewSettings => {
    const result: SessionViewSettings = {};
    if (['code', 'preview', 'examples', 'settings'].includes(String(input.panel))) {
        result.panel = input.panel as SessionViewSettings['panel'];
    }
    if (['auto', 'light', 'dark'].includes(String(input.theme))) {
        result.theme = input.theme as SessionViewSettings['theme'];
    }
    for (const key of ['zoom', 'scrollTop', 'scrollLeft'] as const) {
        if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = input[key];
    }
    return result;
};

const cleanRendererOptions = (input: Record<string, unknown>): Record<string, string> => Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

export const createSessionCell = (
    storage: SessionCellStorage,
    options: SessionCellOptions = {},
): { fetch(request: Request): Promise<Response>; expire(): Promise<void> } => {
    const now = options.now || Date.now;
    const maxDocumentBytes = options.maxDocumentBytes ?? SessionDocument.DEFAULT_MAX_DOCUMENT_BYTES;
    const maxWritesPerMinute = options.maxWritesPerMinute ?? 60;
    const idleTtlMs = options.idleTtlMs ?? 24 * 60 * 60 * 1000;
    const writeTimes: number[] = [];

    const touch = async () => storage.setAlarm(now() + idleTtlMs);
    const load = async (): Promise<SessionDocument | null> => {
        const persisted = await storage.get<PersistedSessionDocument>(DOCUMENT_KEY);
        return persisted ? SessionDocument.fromPersisted(persisted, { maxDocumentBytes }) : null;
    };
    const save = async (document: SessionDocument): Promise<void> => {
        await storage.put(DOCUMENT_KEY, document.exportPersisted());
        await touch();
    };
    const acceptWrite = (): boolean => {
        const cutoff = now() - 60_000;
        while (writeTimes[0] !== undefined && writeTimes[0] <= cutoff) writeTimes.shift();
        if (writeTimes.length >= maxWritesPerMinute) return false;
        writeTimes.push(now());
        return true;
    };

    const fetch = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '') || '/';
        try {
            if (path === '/initialize' && request.method === 'POST') {
                if (await load()) return json({ error: 'Session already exists' }, 409);
                const body = await parseObject(request);
                if (typeof body.language !== 'string' || typeof body.source !== 'string') {
                    return json({ error: 'language and source are required strings' }, 400);
                }
                const document = SessionDocument.create(
                    { language: body.language, source: body.source },
                    { maxDocumentBytes },
                );
                await save(document);
                return json(document.sharedState(), 201);
            }

            const document = await load();
            if (!document) return json({ error: 'Session not found' }, 404);

            if (path === '/state' && request.method === 'GET') {
                await touch();
                return json({ ...document.sharedState(), history: document.history() });
            }

            if (path === '/snapshot' && request.method === 'GET') {
                await touch();
                const snapshot = document.exportSnapshot();
                return new Response(snapshot.buffer.slice(
                    snapshot.byteOffset,
                    snapshot.byteOffset + snapshot.byteLength,
                ) as ArrayBuffer, {
                    headers: { 'content-type': 'application/vnd.loro.snapshot' },
                });
            }

            if (path === '/mutate' && request.method === 'POST') {
                if (!acceptWrite()) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                const body = await parseObject(request);
                if ((body.source !== undefined && typeof body.source !== 'string')
                    || (body.language !== undefined && typeof body.language !== 'string')
                    || !['human', 'agent'].includes(String(body.actor))
                    || typeof body.actorId !== 'string') {
                    return json({ error: 'Invalid session mutation' }, 400);
                }
                document.replace(
                    { source: body.source as string | undefined, language: body.language as string | undefined },
                    { actor: body.actor as 'human' | 'agent', actorId: body.actorId },
                    now(),
                );
                await save(document);
                options.onChange?.({
                    type: 'changed',
                    state: document.sharedState(),
                    actor: body.actor as 'human' | 'agent',
                    actorId: body.actorId,
                });
                return json(document.sharedState());
            }

            if (path === '/crdt' && request.method === 'POST') {
                if (!acceptWrite()) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                const body = await parseObject(request);
                if (typeof body.update !== 'string'
                    || !['human', 'agent'].includes(String(body.actor))
                    || typeof body.actorId !== 'string') {
                    return json({ error: 'Invalid CRDT update' }, 400);
                }
                document.importUpdate(base64ToBytes(body.update), {
                    actor: body.actor as 'human' | 'agent',
                    actorId: body.actorId,
                }, now());
                await save(document);
                options.onChange?.({
                    type: 'changed',
                    state: document.sharedState(),
                    actor: body.actor as 'human' | 'agent',
                    actorId: body.actorId,
                });
                return json(document.sharedState());
            }

            if (path === '/undo' && request.method === 'POST') {
                if (!acceptWrite()) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                if (!document.undoLastAgentWrite()) return json({ error: 'No latest agent write to undo' }, 409);
                await save(document);
                options.onChange?.({ type: 'changed', state: document.sharedState(), actor: 'human', actorId: 'undo' });
                return json(document.sharedState());
            }

            if (path === '/close' && request.method === 'POST') {
                await storage.deleteAll();
                options.onChange?.({ type: 'presence', actor: 'agent', actorId: 'session-closed' });
                return new Response(null, { status: 204 });
            }

            const viewMatch = path.match(/^\/view\/([^/]+)$/);
            if (viewMatch) {
                const participantId = decodeURIComponent(viewMatch[1]);
                if (request.method === 'GET') return json(await storage.get<SessionViewSettings>(viewKey(participantId)) || {});
                if (request.method === 'PUT') {
                    const current = await storage.get<SessionViewSettings>(viewKey(participantId)) || {};
                    const next = { ...current, ...cleanViewSettings(await parseObject(request)) };
                    await storage.put(viewKey(participantId), next);
                    await touch();
                    return json(next);
                }
            }

            const rendererMatch = path.match(/^\/renderer-options\/([^/]+)$/);
            if (rendererMatch) {
                const participantId = decodeURIComponent(rendererMatch[1]);
                if (request.method === 'GET') return json(await storage.get<Record<string, string>>(optionsKey(participantId)) || {});
                if (request.method === 'PUT') {
                    const current = await storage.get<Record<string, string>>(optionsKey(participantId)) || {};
                    const next = { ...current, ...cleanRendererOptions(await parseObject(request)) };
                    await storage.put(optionsKey(participantId), next);
                    await touch();
                    return json(next);
                }
            }

            return json({ error: 'Not found' }, 404);
        } catch (error) {
            if (error instanceof SessionLimitError) return json({ error: error.message }, 413);
            return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    };

    return {
        fetch,
        expire: () => storage.deleteAll(),
    };
};
