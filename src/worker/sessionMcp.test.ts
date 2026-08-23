import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionCell, type SessionCellStorage } from '../session/sessionCell';
import { createSessionMcpHandler } from './sessionMcp';

class MemoryStorage implements SessionCellStorage {
    private readonly values = new Map<string, unknown>();
    async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
    async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
    async deleteAll(): Promise<void> { this.values.clear(); }
    async setAlarm(): Promise<void> { /* test clock has no scheduler */ }
}

const rpc = async (
    fetchMcp: (request: Request) => Promise<Response>,
    method: string,
    params: Record<string, unknown>,
    id = 1,
) => {
    const response = await fetchMcp(new Request('https://diagrams.example/mcp/session', {
        method: 'POST',
        headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }));
    const text = await response.text();
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    return JSON.parse(dataLine ? dataLine.slice(6) : text);
};

describe('session-scoped HTTP MCP', () => {
    let cell: ReturnType<typeof createSessionCell>;

    beforeEach(async () => {
        cell = createSessionCell(new MemoryStorage());
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
    });

    it('advertises full editor control without WebMCP', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session',
            cell,
            snapshotBaseUrl: 'https://diagrams.example/',
            render: async () => ({
                data: '<svg/>',
                diagnostics: [],
                provenance: { kind: 'local', rendererId: 'd2-worker', rendererLabel: 'D2', options: {} },
            }),
        });
        const response = await rpc(handler.fetch, 'tools/list', {});
        const names = response.result.tools.map((tool: { name: string }) => tool.name);

        expect(names).toEqual([
            'get_session',
            'set_source',
            'set_language',
            'set_renderer_options',
            'get_view_settings',
            'set_view_settings',
            'render',
            'export',
            'create_snapshot_link',
            'undo_last_agent_write',
            'close_session',
        ]);
    });

    it('writes source through MCP and exposes structured state', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session',
            cell,
            snapshotBaseUrl: 'https://diagrams.example/',
            render: async () => ({
                data: '<svg/>',
                diagnostics: [],
                provenance: { kind: 'local', rendererId: 'd2-worker', rendererLabel: 'D2', options: {} },
            }),
        });

        const response = await rpc(handler.fetch, 'tools/call', {
            name: 'set_source',
            arguments: { source: 'a -> b -> c' },
        });
        expect(response.result.isError).not.toBe(true);
        expect(response.result.structuredContent).toEqual(expect.objectContaining({
            language: 'd2',
            source: 'a -> b -> c',
        }));
        expect(await (await cell.fetch(new Request('https://cell/state'))).json()).toEqual(expect.objectContaining({
            source: 'a -> b -> c',
        }));
    });
});
