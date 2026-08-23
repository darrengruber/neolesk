import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { encode } from '../kroki/coder';
import type { RenderResult } from '../rendering/rendering';

export interface McpSessionCell {
    fetch(request: Request): Promise<Response>;
}

export interface SessionMcpDependencies {
    sessionId: string;
    cell: McpSessionCell;
    snapshotBaseUrl: string;
    render(input: {
        language: string;
        source: string;
        format: string;
        options: Record<string, string>;
    }): Promise<RenderResult>;
    exportBinary?: (input: {
        language: string;
        source: string;
        format: 'png' | 'jpeg' | 'pdf';
        options: Record<string, string>;
    }) => Promise<{ data: string; mimeType: string }>;
}

interface SessionState {
    language: string;
    source: string;
    history?: unknown[];
}

const textResult = (value: Record<string, unknown>) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
});

const cellJson = async <T>(
    cell: McpSessionCell,
    path: string,
    init?: RequestInit,
): Promise<T> => {
    const response = await cell.fetch(new Request(new URL(path, 'https://session.internal'), init));
    if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
        throw new Error(payload.error || `Session cell returned HTTP ${response.status}`);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
};

const putJson = (value: unknown): RequestInit => ({
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
});

const postJson = (value?: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
});

const snapshotLink = (baseUrl: string, state: SessionState): string => {
    const url = new URL(baseUrl);
    url.hash = `${state.language}/svg/${encode(state.source)}`;
    return url.href;
};

export const createSessionMcpHandler = (dependencies: SessionMcpDependencies) => {
    const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'neolesk-session', version: '2.0.0' });

        server.registerTool('get_session', {
            title: 'Get session',
            description: 'Read the current shared diagram source, language, and edit history.',
            annotations: { readOnlyHint: true },
        }, async () => textResult(await cellJson<SessionState>(dependencies.cell, '/state') as unknown as Record<string, unknown>));

        server.registerTool('set_source', {
            title: 'Set diagram source',
            description: 'Replace the shared diagram source. The write is visible and undoable.',
            inputSchema: z.object({ source: z.string().describe('Complete diagram source') }),
        }, async ({ source }) => textResult(await cellJson<SessionState>(dependencies.cell, '/mutate', postJson({
            source,
            actor: 'agent',
            actorId: 'mcp',
        })) as unknown as Record<string, unknown>));

        server.registerTool('set_language', {
            title: 'Set diagram language',
            description: 'Change the shared diagram language.',
            inputSchema: z.object({ language: z.string().min(1) }),
        }, async ({ language }) => textResult(await cellJson<SessionState>(dependencies.cell, '/mutate', postJson({
            language,
            actor: 'agent',
            actorId: 'mcp',
        })) as unknown as Record<string, unknown>));

        server.registerTool('set_renderer_options', {
            title: 'Set renderer options',
            description: 'Set renderer options for the agent participant without moving the human view.',
            inputSchema: z.object({ options: z.record(z.string(), z.string()) }),
        }, async ({ options }) => textResult({
            options: await cellJson<Record<string, string>>(dependencies.cell, '/renderer-options/agent', putJson(options)),
        }));

        server.registerTool('get_view_settings', {
            title: 'Get agent view settings',
            description: 'Read the agent participant view. Human layout, theme, and scroll are separate.',
            annotations: { readOnlyHint: true },
        }, async () => textResult({
            settings: await cellJson<Record<string, unknown>>(dependencies.cell, '/view/agent'),
        }));

        server.registerTool('set_view_settings', {
            title: 'Set agent view settings',
            description: 'Change only the agent participant view.',
            inputSchema: z.object({
                panel: z.enum(['code', 'preview', 'examples', 'settings']).optional(),
                theme: z.enum(['auto', 'light', 'dark']).optional(),
                zoom: z.number().positive().optional(),
                scrollTop: z.number().nonnegative().optional(),
                scrollLeft: z.number().nonnegative().optional(),
            }),
        }, async (settings) => textResult({
            settings: await cellJson<Record<string, unknown>>(dependencies.cell, '/view/agent', putJson(settings)),
        }));

        server.registerTool('render', {
            title: 'Render diagram',
            description: 'Render the current session and return provenance and structured diagnostics.',
            inputSchema: z.object({ format: z.literal('svg').default('svg') }),
            annotations: { readOnlyHint: true },
        }, async ({ format }) => {
            const state = await cellJson<SessionState>(dependencies.cell, '/state');
            const options = await cellJson<Record<string, string>>(dependencies.cell, '/renderer-options/agent');
            const result = await dependencies.render({ ...state, format, options });
            return textResult({
                format,
                data: result.data,
                diagnostics: result.diagnostics,
                provenance: result.provenance,
            });
        });

        server.registerTool('export', {
            title: 'Export diagram',
            description: 'Export the current session as SVG, PNG, JPEG, or PDF.',
            inputSchema: z.object({ format: z.enum(['svg', 'png', 'jpeg', 'pdf']) }),
            annotations: { readOnlyHint: true },
        }, async ({ format }) => {
            const state = await cellJson<SessionState>(dependencies.cell, '/state');
            const options = await cellJson<Record<string, string>>(dependencies.cell, '/renderer-options/agent');
            if (format === 'svg') {
                const result = await dependencies.render({ ...state, format, options });
                return textResult({ format, mimeType: 'image/svg+xml', data: result.data, diagnostics: result.diagnostics, provenance: result.provenance });
            }
            if (!dependencies.exportBinary) throw new Error(`${format.toUpperCase()} export is unavailable`);
            const exported = await dependencies.exportBinary({ ...state, format, options });
            return textResult({ format, ...exported });
        });

        server.registerTool('create_snapshot_link', {
            title: 'Create snapshot link',
            description: 'Create an immutable, self-contained URL for the current diagram.',
            annotations: { readOnlyHint: true },
        }, async () => {
            const state = await cellJson<SessionState>(dependencies.cell, '/state');
            return textResult({ url: snapshotLink(dependencies.snapshotBaseUrl, state) });
        });

        server.registerTool('undo_last_agent_write', {
            title: 'Undo latest agent write',
            description: 'Restore the shared document from before the latest agent write.',
        }, async () => textResult(await cellJson<SessionState>(dependencies.cell, '/undo', postJson()) as unknown as Record<string, unknown>));

        server.registerTool('close_session', {
            title: 'Close session',
            description: 'Permanently close this working session. Snapshot links remain durable.',
            annotations: { destructiveHint: true },
        }, async () => {
            await cellJson<void>(dependencies.cell, '/close', postJson());
            return textResult({ closed: true, sessionId: dependencies.sessionId });
        });

        return server;
    }, { responseMode: 'json' });

    return {
        fetch: handler.fetch,
        close: handler.close,
    };
};
