import {
    SessionDocument,
    SessionLimitError,
    type PersistedSessionDocument,
    type SessionSnapshot,
    type SessionViewSettings,
} from './sessionDocument';
import { base64ToBytes } from './base64';
import { RenderingError, type RenderResult } from '../rendering/rendering';
import { limitRequestBody, RequestBodyTooLargeError } from '../worker/requestLimits';

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
    maxAgentWritesPerMinute?: number;
    maxHumanWritesPerMinute?: number;
    maxParticipants?: number;
    maxRendersPerMinute?: number;
    maxExportsPerMinute?: number;
    maxConcurrentRenders?: number;
    maxConcurrentExports?: number;
    maxExportBytes?: number;
    maxRequestBodyBytes?: number;
    idleTtlMs?: number;
    agentLeaseMs?: number;
    onChange?: (message: SessionChangeMessage) => void;
    validateLanguage?: (language: string) => boolean;
    validateRendererOptions?: (language: string, options: Record<string, string>) => Record<string, string>;
    render?: (input: SessionRenderInput) => Promise<RenderResult>;
    exportBinary?: (input: SessionExportInput) => Promise<{ data: Uint8Array; mimeType: string }>;
}

export interface SessionRenderInput extends SessionSnapshot {
    format: string;
    options: Record<string, string>;
}

export interface SessionExportInput extends SessionSnapshot {
    format: 'png' | 'jpeg' | 'pdf';
    options: Record<string, string>;
    rendererId: 'neolesk' | 'kroki-io';
    maxBytes: number;
}

export interface SessionChangeMessage {
    type: 'changed' | 'presence' | 'closed';
    state?: 'connected' | 'disconnected';
    actor?: 'human' | 'agent';
    actorId?: string;
    fields?: string[];
}

type AgentUndoOperation =
    | { kind: 'document'; at: number; undo?: Uint8Array }
    | { kind: 'view'; at: number; participantId: string; previous: SessionViewSettings }
    | { kind: 'renderer-options'; at: number; participantId: string; language: string; previous: Record<string, string> };

const DOCUMENT_KEY = 'document';
const RATE_LIMIT_KEY = 'rate-limit';
const OPERATION_RATE_LIMIT_KEY = 'operation-rate-limit';
const PARTICIPANTS_KEY = 'participants';
const AGENT_UNDO_KEY = 'agent-undo';
const LAST_ACTIVITY_KEY = 'last-activity';
const AGENT_LEASE_KEY = 'agent-lease';
const MAX_AGENT_UNDO_OPERATIONS = 64;
const viewKey = (participantId: string) => `view:${participantId}`;
const optionsKey = (participantId: string, language: string) => `renderer-options:${participantId}:${language}`;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const PARTICIPANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
    if (['examples', 'syntax'].includes(String(input.sidebar))) {
        result.sidebar = input.sidebar as SessionViewSettings['sidebar'];
    }
    if (typeof input.zoom === 'number' && Number.isFinite(input.zoom)) {
        result.zoom = Math.min(4, Math.max(0.25, input.zoom));
    }
    if (typeof input.splitPercent === 'number' && Number.isFinite(input.splitPercent)) {
        result.splitPercent = Math.min(80, Math.max(20, input.splitPercent));
    }
    for (const key of ['scrollTop', 'scrollLeft', 'previewScrollTop', 'previewScrollLeft'] as const) {
        if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(0, input[key]);
    }
    return result;
};

const cleanRendererOptions = (input: Record<string, unknown>): Record<string, string> => Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => (
        /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(entry[0])
        && typeof entry[1] === 'string'
        && entry[1].length <= 128
    )).slice(0, 16),
);

export const createSessionCell = (
    storage: SessionCellStorage,
    options: SessionCellOptions = {},
): { fetch(request: Request): Promise<Response>; expire(options?: { keepAlive?: boolean }): Promise<void> } => {
    const now = options.now || Date.now;
    const maxDocumentBytes = options.maxDocumentBytes ?? SessionDocument.DEFAULT_MAX_DOCUMENT_BYTES;
    const maxAgentWritesPerMinute = options.maxAgentWritesPerMinute ?? options.maxWritesPerMinute ?? 60;
    const maxHumanWritesPerMinute = options.maxHumanWritesPerMinute ?? options.maxWritesPerMinute ?? 180;
    const maxParticipants = options.maxParticipants ?? 32;
    const maxRendersPerMinute = options.maxRendersPerMinute ?? 60;
    const maxExportsPerMinute = options.maxExportsPerMinute ?? 20;
    const maxConcurrentRenders = options.maxConcurrentRenders ?? 2;
    const maxConcurrentExports = options.maxConcurrentExports ?? 1;
    const maxExportBytes = options.maxExportBytes ?? 32 * 1024 * 1024;
    const maxRequestBodyBytes = options.maxRequestBodyBytes ?? 512 * 1024;
    const idleTtlMs = options.idleTtlMs ?? 24 * 60 * 60 * 1000;
    const agentLeaseMs = options.agentLeaseMs ?? 30_000;
    let rendersInFlight = 0;
    let exportsInFlight = 0;

    const scheduleAlarm = async (lastActivity: number): Promise<void> => {
        const lease = await storage.get<{ until: number; actorId: string }>(AGENT_LEASE_KEY);
        const idleAt = lastActivity + idleTtlMs;
        await storage.setAlarm(lease && lease.until > now() ? Math.min(idleAt, lease.until) : idleAt);
    };
    const touch = async () => {
        const at = now();
        await storage.put(LAST_ACTIVITY_KEY, at);
        await scheduleAlarm(at);
    };
    const load = async (): Promise<SessionDocument | null> => {
        const persisted = await storage.get<PersistedSessionDocument>(DOCUMENT_KEY);
        return persisted ? SessionDocument.fromPersisted(persisted, { maxDocumentBytes }) : null;
    };
    const save = async (document: SessionDocument): Promise<void> => {
        await storage.put(DOCUMENT_KEY, document.exportPersisted());
        await touch();
    };
    const acceptWrite = async (actor: 'human' | 'agent'): Promise<boolean> => {
        const cutoff = now() - 60_000;
        const state = await storage.get<{ human: number[]; agent: number[] }>(RATE_LIMIT_KEY)
            || { human: [], agent: [] };
        state.human = state.human.filter((value) => value > cutoff);
        state.agent = state.agent.filter((value) => value > cutoff);
        const writes = state[actor];
        const limit = actor === 'agent' ? maxAgentWritesPerMinute : maxHumanWritesPerMinute;
        if (writes.length >= limit) return false;
        writes.push(now());
        await storage.put(RATE_LIMIT_KEY, state);
        return true;
    };
    const acceptOperation = async (operation: 'render' | 'export'): Promise<boolean> => {
        const cutoff = now() - 60_000;
        const state = await storage.get<{ render: number[]; export: number[] }>(OPERATION_RATE_LIMIT_KEY)
            || { render: [], export: [] };
        state.render = state.render.filter((value) => value > cutoff);
        state.export = state.export.filter((value) => value > cutoff);
        const attempts = state[operation];
        const limit = operation === 'render' ? maxRendersPerMinute : maxExportsPerMinute;
        if (attempts.length >= limit) return false;
        attempts.push(now());
        await storage.put(OPERATION_RATE_LIMIT_KEY, state);
        return true;
    };
    const participant = (encoded: string): string => {
        const value = decodeURIComponent(encoded);
        if (!PARTICIPANT_ID.test(value)) throw new Error('Invalid participant identifier');
        return value;
    };
    const registerParticipant = async (participantId: string): Promise<void> => {
        const participants = await storage.get<string[]>(PARTICIPANTS_KEY) || [];
        if (participants.includes(participantId)) return;
        if (participants.length >= maxParticipants) {
            throw new SessionLimitError(participants.length + 1, maxParticipants);
        }
        await storage.put(PARTICIPANTS_KEY, [...participants, participantId]);
    };
    const pushAgentUndo = async (operation: AgentUndoOperation): Promise<void> => {
        const stack = await storage.get<AgentUndoOperation[]>(AGENT_UNDO_KEY) || [];
        stack.push(operation);
        await storage.put(AGENT_UNDO_KEY, stack.slice(-MAX_AGENT_UNDO_OPERATIONS).map((entry) => (
            entry.kind === 'document' ? { kind: 'document' as const, at: entry.at } : entry
        )));
    };

    const fetch = async (initialRequest: Request): Promise<Response> => {
        let request = initialRequest;
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '') || '/';
        try {
            request = await limitRequestBody(request, maxRequestBodyBytes);
            if (path === '/initialize' && request.method === 'POST') {
                if (await load()) return json({ error: 'Session already exists' }, 409);
                const body = await parseObject(request);
                if (typeof body.language !== 'string' || typeof body.source !== 'string') {
                    return json({ error: 'language and source are required strings' }, 400);
                }
                if (options.validateLanguage && !options.validateLanguage(body.language)) {
                    return json({ error: 'Unsupported diagram language' }, 400);
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

            if (path === '/presence' && request.method === 'POST') {
                const body = await parseObject(request);
                const actor = body.actor === 'agent' ? 'agent' : 'human';
                const actorId = typeof body.actorId === 'string' && body.actorId.length <= 64
                    ? body.actorId
                    : actor;
                const state = body.state === 'disconnected' ? 'disconnected' : 'connected';
                if (actor === 'agent') {
                    await storage.put(AGENT_LEASE_KEY, {
                        until: state === 'connected' ? now() + agentLeaseMs : 0,
                        actorId,
                    });
                }
                options.onChange?.({ type: 'presence', actor, actorId, state, fields: [] });
                await touch();
                return new Response(null, { status: 204 });
            }

            if (path === '/presence' && request.method === 'GET') {
                const lease = await storage.get<{ until: number; actorId: string }>(AGENT_LEASE_KEY);
                return json({
                    type: 'presence',
                    actor: 'agent',
                    actorId: lease?.actorId || 'mcp',
                    state: lease && lease.until > now() ? 'connected' : 'disconnected',
                });
            }

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
                const body = await parseObject(request);
                if ((body.source !== undefined && typeof body.source !== 'string')
                    || (body.language !== undefined && typeof body.language !== 'string')
                    || !['human', 'agent'].includes(String(body.actor))
                    || typeof body.actorId !== 'string') {
                    return json({ error: 'Invalid session mutation' }, 400);
                }
                if (typeof body.language === 'string' && options.validateLanguage && !options.validateLanguage(body.language)) {
                    return json({ error: 'Unsupported diagram language' }, 400);
                }
                const actor = body.actor as 'human' | 'agent';
                if (!await acceptWrite(actor)) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                const fields = document.replace(
                    { source: body.source as string | undefined, language: body.language as string | undefined },
                    { actor, actorId: body.actorId },
                    now(),
                );
                await save(document);
                if (actor === 'agent' && fields.length > 0) {
                    if (!document.latestAgentUndoUpdate()) throw new Error('Could not retain an inverse for the agent write');
                    await pushAgentUndo({ kind: 'document', at: now() });
                }
                options.onChange?.({
                    type: 'changed',
                    actor,
                    actorId: body.actorId,
                    fields,
                });
                return json(document.sharedState());
            }

            if (path === '/crdt' && request.method === 'POST') {
                const body = await parseObject(request);
                if (typeof body.update !== 'string'
                    || typeof body.actorId !== 'string') {
                    return json({ error: 'Invalid CRDT update' }, 400);
                }
                if (!await acceptWrite('human')) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                document.importUpdate(base64ToBytes(body.update), {
                    actor: 'human',
                    actorId: body.actorId,
                }, now());
                if (options.validateLanguage && !options.validateLanguage(document.sharedState().language)) {
                    return json({ error: 'Unsupported diagram language' }, 400);
                }
                await save(document);
                options.onChange?.({
                    type: 'changed',
                    actor: 'human',
                    actorId: body.actorId,
                    fields: ['source', 'language'],
                });
                return json(document.sharedState());
            }

            if (path === '/undo' && request.method === 'POST') {
                const body = await request.json().catch(() => ({})) as Record<string, unknown>;
                const actor = body.actor === 'agent' ? 'agent' : 'human';
                if (!await acceptWrite(actor)) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                const stack = await storage.get<AgentUndoOperation[]>(AGENT_UNDO_KEY) || [];
                let fields: string[] | null = null;
                while (stack.length > 0 && !fields) {
                    const operation = stack.pop() as AgentUndoOperation;
                    if (operation.kind === 'document') {
                        if (document.undoLastAgentWrite(operation.undo)) fields = ['source', 'language'];
                    } else if (operation.kind === 'view') {
                        await storage.put(viewKey(operation.participantId), operation.previous);
                        fields = ['view'];
                    } else {
                        await storage.put(optionsKey(operation.participantId, operation.language), operation.previous);
                        fields = ['renderer options'];
                    }
                }
                if (!fields && document.undoLastAgentWrite()) fields = ['source', 'language'];
                if (!fields) return json({ error: 'No latest agent write to undo' }, 409);
                await storage.put(AGENT_UNDO_KEY, stack);
                await save(document);
                options.onChange?.({ type: 'changed', actor, actorId: 'undo', fields });
                return json(document.sharedState());
            }

            if (path === '/close' && request.method === 'POST') {
                const body = await request.json().catch(() => ({})) as Record<string, unknown>;
                const actor = body.actor === 'human' ? 'human' : 'agent';
                if (!await acceptWrite(actor)) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                await storage.deleteAll();
                options.onChange?.({ type: 'closed', actor, actorId: 'session-closed', fields: [] });
                return new Response(null, { status: 204 });
            }

            const viewMatch = path.match(/^\/view\/([^/]+)$/);
            if (viewMatch) {
                const participantId = participant(viewMatch[1]);
                if (request.method === 'GET') return json(await storage.get<SessionViewSettings>(viewKey(participantId)) || {});
                if (request.method === 'PUT') {
                    if (!await acceptWrite(participantId === 'agent' ? 'agent' : 'human')) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                    await registerParticipant(participantId);
                    const current = await storage.get<SessionViewSettings>(viewKey(participantId)) || {};
                    const next = { ...current, ...cleanViewSettings(await parseObject(request)) };
                    await storage.put(viewKey(participantId), next);
                    if (participantId === 'agent' && JSON.stringify(current) !== JSON.stringify(next)) {
                        await pushAgentUndo({ kind: 'view', at: now(), participantId, previous: current });
                        options.onChange?.({
                            type: 'changed', actor: 'agent', actorId: participantId, fields: ['view'],
                        });
                    }
                    await touch();
                    return json(next);
                }
            }

            const rendererMatch = path.match(/^\/renderer-options\/([^/]+)$/);
            if (rendererMatch) {
                const participantId = participant(rendererMatch[1]);
                const language = document.sharedState().language;
                if (request.method === 'GET') return json(await storage.get<Record<string, string>>(optionsKey(participantId, language)) || {});
                if (request.method === 'PUT') {
                    if (!await acceptWrite(participantId === 'agent' ? 'agent' : 'human')) return json({ error: 'Session write rate limit exceeded' }, 429, { 'retry-after': '60' });
                    await registerParticipant(participantId);
                    const current = await storage.get<Record<string, string>>(optionsKey(participantId, language)) || {};
                    const cleaned = cleanRendererOptions(await parseObject(request));
                    const next = options.validateRendererOptions
                        ? options.validateRendererOptions(language, cleaned)
                        : cleaned;
                    await storage.put(optionsKey(participantId, language), next);
                    if (participantId === 'agent' && JSON.stringify(current) !== JSON.stringify(next)) {
                        await pushAgentUndo({ kind: 'renderer-options', at: now(), participantId, language, previous: current });
                        options.onChange?.({
                            type: 'changed', actor: 'agent', actorId: participantId, fields: ['renderer options'],
                        });
                    }
                    await touch();
                    return json(next);
                }
            }

            if (path === '/render' && request.method === 'POST') {
                if (!options.render) return json({ error: 'Rendering is unavailable' }, 503);
                const body = await parseObject(request);
                const participantId = participant(typeof body.participantId === 'string' ? body.participantId : 'agent');
                const format = typeof body.format === 'string' ? body.format : 'svg';
                if (!await acceptOperation('render')) {
                    return json({ error: 'Session render rate limit exceeded' }, 429, { 'retry-after': '60' });
                }
                if (rendersInFlight >= maxConcurrentRenders) {
                    return json({ error: 'Too many concurrent session renders' }, 429, { 'retry-after': '1' });
                }
                const rendererOptions = await storage.get<Record<string, string>>(
                    optionsKey(participantId, document.sharedState().language),
                ) || {};
                rendersInFlight += 1;
                try {
                    return json(await options.render({ ...document.sharedState(), format, options: rendererOptions }));
                } finally {
                    rendersInFlight -= 1;
                }
            }

            if (path === '/export' && request.method === 'POST') {
                if (!options.exportBinary) return json({ error: 'Binary export is unavailable' }, 503);
                const body = await parseObject(request);
                const participantId = participant(typeof body.participantId === 'string' ? body.participantId : 'agent');
                if (!['png', 'jpeg', 'pdf'].includes(String(body.format))) return json({ error: 'Invalid export format' }, 400);
                if (!['neolesk', 'kroki-io'].includes(String(body.rendererId))) return json({ error: 'Invalid export renderer' }, 400);
                if (body.maxBytes !== undefined && (typeof body.maxBytes !== 'number'
                    || !Number.isFinite(body.maxBytes) || body.maxBytes <= 0)) {
                    return json({ error: 'Invalid export byte limit' }, 400);
                }
                const requestedMaxBytes = body.maxBytes === undefined
                    ? maxExportBytes
                    : Math.floor(body.maxBytes as number);
                if (!await acceptOperation('export')) {
                    return json({ error: 'Session export rate limit exceeded' }, 429, { 'retry-after': '60' });
                }
                if (exportsInFlight >= maxConcurrentExports) {
                    return json({ error: 'Too many concurrent session exports' }, 429, { 'retry-after': '1' });
                }
                const rendererOptions = await storage.get<Record<string, string>>(
                    optionsKey(participantId, document.sharedState().language),
                ) || {};
                exportsInFlight += 1;
                try {
                    const exported = await options.exportBinary({
                        ...document.sharedState(),
                        format: body.format as 'png' | 'jpeg' | 'pdf',
                        options: rendererOptions,
                        rendererId: body.rendererId as 'neolesk' | 'kroki-io',
                        maxBytes: Math.min(maxExportBytes, requestedMaxBytes),
                    });
                    return new Response(exported.data.buffer.slice(
                        exported.data.byteOffset,
                        exported.data.byteOffset + exported.data.byteLength,
                    ) as ArrayBuffer, { headers: {
                        'content-type': exported.mimeType,
                        'content-length': String(exported.data.byteLength),
                        'cache-control': 'no-store',
                    } });
                } finally {
                    exportsInFlight -= 1;
                }
            }

            return json({ error: 'Not found' }, 404);
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) return json({ error: error.message }, 413);
            if (error instanceof SessionLimitError) return json({ error: error.message }, 413);
            if (error instanceof RenderingError) return json({
                error: error.message,
                code: error.code,
                language: error.language,
                diagnostics: error.diagnostics,
            }, 422);
            return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    };

    return {
        fetch,
        expire: async ({ keepAlive = false }: { keepAlive?: boolean } = {}) => {
            const at = now();
            const lease = await storage.get<{ until: number; actorId: string }>(AGENT_LEASE_KEY);
            if (lease && lease.until > 0 && lease.until <= at) {
                await storage.put(AGENT_LEASE_KEY, { ...lease, until: 0 });
                options.onChange?.({
                    type: 'presence', actor: 'agent', actorId: lease.actorId, state: 'disconnected', fields: [],
                });
            }
            const lastActivity = await storage.get<number>(LAST_ACTIVITY_KEY) ?? at;
            if (keepAlive) {
                await storage.put(LAST_ACTIVITY_KEY, at);
                await scheduleAlarm(at);
            } else if (lastActivity + idleTtlMs > at) {
                await scheduleAlarm(lastActivity);
            } else {
                await storage.deleteAll();
            }
        },
    };
};
