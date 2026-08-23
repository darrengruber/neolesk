import { bytesToBase64 } from '../session/base64';
import { readResponseBytes } from '../rendering/remote';
import { limitRequestBody, RequestBodyTooLargeError } from './requestLimits';

export interface McpSessionCell {
    fetch(request: Request): Promise<Response>;
}

export interface SessionMcpDependencies {
    sessionId: string;
    cell: McpSessionCell;
    snapshotBaseUrl: string;
    maxRequestBodyBytes?: number;
    maxExportBytes?: number;
}

interface SessionState {
    language: string;
    source: string;
    history?: unknown[];
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION]);

const JSON_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};

const textResult = (value: Record<string, unknown>, isError = false) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
});

const binaryResult = (
    sessionId: string,
    format: string,
    mimeType: string,
    bytes: Uint8Array,
) => {
    const data = bytesToBase64(bytes);
    const content = format === 'pdf'
        ? [{
            type: 'resource' as const,
            resource: {
                uri: `neolesk://session/${sessionId}/export.pdf`,
                mimeType,
                blob: data,
            },
        }]
        : [{ type: 'image' as const, mimeType, data }];
    return {
        content,
        structuredContent: { format, mimeType, byteLength: bytes.byteLength },
    };
};

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
    status,
    headers: JSON_HEADERS,
});

const cellJson = async <T>(cell: McpSessionCell, path: string, init?: RequestInit): Promise<T> => {
    const response = await cell.fetch(new Request(new URL(path, 'https://session.internal'), init));
    if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
        throw new Error(payload.error || `Session cell returned HTTP ${response.status}`);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
};

const putJson = (value: unknown): RequestInit => ({
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});
const postJson = (value?: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
});

const cellToolResult = async (
    cell: McpSessionCell,
    path: string,
    init: RequestInit,
    publicOrigin?: string,
) => {
    const headers = new Headers(init.headers);
    if (publicOrigin) headers.set('x-neolesk-public-origin', publicOrigin);
    const response = await cell.fetch(new Request(new URL(path, 'https://session.internal'), { ...init, headers }));
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as Record<string, unknown>;
    return textResult(payload, !response.ok);
};

const encodeSnapshotSource = async (source: string): Promise<string> => {
    const compressed = new Blob([new TextEncoder().encode(source)])
        .stream()
        .pipeThrough(new CompressionStream('deflate'));
    const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_');
};

const snapshotLink = async (baseUrl: string, state: SessionState): Promise<string> => {
    const url = new URL(baseUrl);
    url.hash = `${state.language}/svg/${await encodeSnapshotSource(state.source)}`;
    return url.href;
};

const objectArguments = (params: Record<string, unknown> | undefined): Record<string, unknown> => {
    const value = params?.arguments;
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
};

const requiredString = (value: unknown, name: string): string => {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string`);
    return value;
};

const stringRecord = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('options must be an object');
    const entries = Object.entries(value);
    if (!entries.every(([, entry]) => typeof entry === 'string')) throw new Error('renderer option values must be strings');
    return Object.fromEntries(entries) as Record<string, string>;
};

const viewSettings = (value: Record<string, unknown>): Record<string, unknown> => {
    const allowed = new Set([
        'panel', 'sidebar', 'theme', 'zoom', 'splitPercent',
        'scrollTop', 'scrollLeft', 'previewScrollTop', 'previewScrollLeft',
    ]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`Unsupported view setting ${key}`);
    }
    const enumSetting = (key: string, values: string[]) => {
        if (value[key] !== undefined && !values.includes(String(value[key]))) {
            throw new Error(`${key} must be one of ${values.join(', ')}`);
        }
    };
    const boundedNumber = (key: string, minimum: number, maximum?: number) => {
        if (value[key] === undefined) return;
        const number = value[key];
        if (typeof number !== 'number' || !Number.isFinite(number)
            || number < minimum || (maximum !== undefined && number > maximum)) {
            throw new Error(maximum === undefined
                ? `${key} must be at least ${minimum}`
                : `${key} must be between ${minimum} and ${maximum}`);
        }
    };
    enumSetting('panel', ['code', 'preview', 'examples', 'settings']);
    enumSetting('sidebar', ['examples', 'syntax']);
    enumSetting('theme', ['auto', 'light', 'dark']);
    boundedNumber('zoom', 0.25, 4);
    boundedNumber('splitPercent', 20, 80);
    for (const key of ['scrollTop', 'scrollLeft', 'previewScrollTop', 'previewScrollLeft']) {
        boundedNumber(key, 0);
    }
    return value;
};

const tools = [
    {
        name: 'get_session', title: 'Get session',
        description: 'Read the current shared diagram source, language, and edit history.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
    },
    {
        name: 'set_source', title: 'Set diagram source',
        description: 'Replace the shared diagram source. The write is visible and undoable.',
        inputSchema: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'], additionalProperties: false },
    },
    {
        name: 'set_language', title: 'Set diagram language', description: 'Change the shared diagram language.',
        inputSchema: { type: 'object', properties: { language: { type: 'string', minLength: 1 } }, required: ['language'], additionalProperties: false },
    },
    {
        name: 'set_renderer_options', title: 'Set renderer options',
        description: 'Set renderer options for the agent participant without moving the human view.',
        inputSchema: {
            type: 'object', properties: { options: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['options'], additionalProperties: false,
        },
    },
    {
        name: 'get_view_settings', title: 'Get agent view settings',
        description: 'Read the agent participant view. Human layout, theme, and scroll are separate.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
    },
    {
        name: 'set_view_settings', title: 'Set agent view settings',
        description: 'Change only the agent participant view.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {
            panel: { enum: ['code', 'preview', 'examples', 'settings'] }, sidebar: { enum: ['examples', 'syntax'] },
            theme: { enum: ['auto', 'light', 'dark'] }, zoom: { type: 'number', minimum: 0.25, maximum: 4 },
            splitPercent: { type: 'number', minimum: 20, maximum: 80 },
            scrollTop: { type: 'number', minimum: 0 }, scrollLeft: { type: 'number', minimum: 0 },
            previewScrollTop: { type: 'number', minimum: 0 }, previewScrollLeft: { type: 'number', minimum: 0 },
        } },
    },
    {
        name: 'render', title: 'Render diagram',
        description: 'Render the current session and return provenance and structured diagnostics.',
        inputSchema: { type: 'object', properties: { format: { const: 'svg', default: 'svg' } }, additionalProperties: false },
        annotations: { readOnlyHint: true },
    },
    {
        name: 'export', title: 'Export diagram', description: 'Export the current session as SVG, PNG, JPEG, or PDF.',
        inputSchema: { type: 'object', properties: { format: { enum: ['svg', 'png', 'jpeg', 'pdf'] } }, required: ['format'], additionalProperties: false },
        annotations: { readOnlyHint: true },
    },
    {
        name: 'create_snapshot_link', title: 'Create snapshot link',
        description: 'Create an immutable, self-contained URL for the current diagram.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
    },
    {
        name: 'undo_last_agent_write', title: 'Undo latest agent write',
        description: 'Restore the shared document from before the latest agent write.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'close_session', title: 'Close session',
        description: 'Permanently close this working session. Snapshot links remain durable.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { destructiveHint: true },
    },
];

const executeTool = async (
    dependencies: SessionMcpDependencies,
    name: unknown,
    args: Record<string, unknown>,
) => {
    if (name === 'get_session') {
        return textResult(await cellJson<SessionState>(dependencies.cell, '/state') as unknown as Record<string, unknown>);
    }
    if (name === 'set_source') {
        return textResult(await cellJson<SessionState>(dependencies.cell, '/mutate', postJson({
            source: requiredString(args.source, 'source'), actor: 'agent', actorId: 'mcp',
        })) as unknown as Record<string, unknown>);
    }
    if (name === 'set_language') {
        return textResult(await cellJson<SessionState>(dependencies.cell, '/mutate', postJson({
            language: requiredString(args.language, 'language'), actor: 'agent', actorId: 'mcp',
        })) as unknown as Record<string, unknown>);
    }
    if (name === 'set_renderer_options') {
        return textResult({ options: await cellJson<Record<string, string>>(
            dependencies.cell, '/renderer-options/agent', putJson(stringRecord(args.options)),
        ) });
    }
    if (name === 'get_view_settings') {
        return textResult({ settings: await cellJson<Record<string, unknown>>(dependencies.cell, '/view/agent') });
    }
    if (name === 'set_view_settings') {
        return textResult({ settings: await cellJson<Record<string, unknown>>(
            dependencies.cell, '/view/agent', putJson(viewSettings(args)),
        ) });
    }
    if (name === 'render') {
        if (args.format !== undefined && args.format !== 'svg') throw new Error('format must be svg');
        return cellToolResult(
            dependencies.cell,
            '/render',
            postJson({ participantId: 'agent', format: 'svg' }),
            new URL(dependencies.snapshotBaseUrl).origin,
        );
    }
    if (name === 'export') {
        const format = requiredString(args.format, 'format');
        if (!['svg', 'png', 'jpeg', 'pdf'].includes(format)) throw new Error('Unsupported export format');
        if (format === 'svg') {
            const response = await dependencies.cell.fetch(new Request(
                'https://session.internal/render', postJson({ participantId: 'agent', format }),
            ));
            const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as Record<string, unknown>;
            return textResult({ format, mimeType: 'image/svg+xml', ...result }, !response.ok);
        }
        const response = await dependencies.cell.fetch(new Request('https://session.internal/export', postJson({
            participantId: 'agent', format, rendererId: 'neolesk',
            maxBytes: dependencies.maxExportBytes ?? 4 * 1024 * 1024,
        })));
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as Record<string, unknown>;
            return textResult(error, true);
        }
        const mimeType = response.headers.get('content-type') || `image/${format}`;
        const bytes = await readResponseBytes(response, dependencies.maxExportBytes ?? 4 * 1024 * 1024);
        return binaryResult(dependencies.sessionId, format, mimeType, bytes);
    }
    if (name === 'create_snapshot_link') {
        const state = await cellJson<SessionState>(dependencies.cell, '/state');
        return textResult({ url: await snapshotLink(dependencies.snapshotBaseUrl, state) });
    }
    if (name === 'undo_last_agent_write') {
        return textResult(await cellJson<SessionState>(dependencies.cell, '/undo', postJson({ actor: 'agent' })) as unknown as Record<string, unknown>);
    }
    if (name === 'close_session') {
        await cellJson<void>(dependencies.cell, '/close', postJson({ actor: 'agent' }));
        return textResult({ closed: true, sessionId: dependencies.sessionId });
    }
    throw new Error(`Unknown tool ${String(name)}`);
};

export const createSessionMcpHandler = (dependencies: SessionMcpDependencies) => ({
    fetch: async (initialRequest: Request): Promise<Response> => {
        let request = initialRequest;
        const requestUrl = new URL(request.url);
        const origin = request.headers.get('origin');
        if (origin) {
            try {
                if (new URL(origin).origin !== requestUrl.origin) return json({ error: 'Forbidden origin' }, 403);
            } catch {
                return json({ error: 'Forbidden origin' }, 403);
            }
        }
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        try {
            request = await limitRequestBody(request, dependencies.maxRequestBodyBytes ?? 512 * 1024);
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) return json({ error: error.message }, 413);
            throw error;
        }

        let rpc: JsonRpcRequest;
        try {
            rpc = await request.json() as JsonRpcRequest;
            if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') throw new Error('Invalid JSON-RPC request');
        } catch (error) {
            return json({
                jsonrpc: '2.0', id: null,
                error: { code: -32700, message: error instanceof Error ? error.message : 'Parse error' },
            }, 400);
        }

        if (rpc.method !== 'initialize') {
            const protocolVersion = request.headers.get('mcp-protocol-version') || '2025-03-26';
            if (!SUPPORTED_MCP_PROTOCOL_VERSIONS.has(protocolVersion)) {
                return json({ error: `Unsupported MCP protocol version ${protocolVersion}` }, 400);
            }
        }

        const presence = await dependencies.cell.fetch(new Request('https://session.internal/presence', postJson({
            actor: 'agent', actorId: 'mcp', state: 'connected',
        })));
        if (!presence.ok) {
            const payload = await presence.json().catch(() => ({ error: `Session returned HTTP ${presence.status}` }));
            return json(payload, presence.status);
        }

        if (rpc.id === undefined) return new Response(null, { status: 202 });
        try {
            let result: unknown;
            if (rpc.method === 'initialize') {
                const requestedVersion = rpc.params?.protocolVersion;
                result = {
                    protocolVersion: typeof requestedVersion === 'string'
                        && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedVersion)
                        ? requestedVersion
                        : MCP_PROTOCOL_VERSION,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'neolesk-session', version: '2.0.0' },
                };
            } else if (rpc.method === 'ping') result = {};
            else if (rpc.method === 'tools/list') result = { tools };
            else if (rpc.method === 'tools/call') {
                try {
                    result = await executeTool(dependencies, rpc.params?.name, objectArguments(rpc.params));
                } catch (error) {
                    result = textResult({ error: error instanceof Error ? error.message : String(error) }, true);
                }
            } else {
                return json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
            }
            return json({ jsonrpc: '2.0', id: rpc.id, result });
        } catch (error) {
            return json({
                jsonrpc: '2.0', id: rpc.id,
                error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
            });
        }
    },
    close: async () => {
        await dependencies.cell.fetch(new Request('https://session.internal/presence', postJson({
            actor: 'agent', actorId: 'mcp', state: 'disconnected',
        })));
    },
});
