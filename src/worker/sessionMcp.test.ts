import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { RenderingError } from '../rendering/rendering';
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
            'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }));
    const text = await response.text();
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    return JSON.parse(dataLine ? dataLine.slice(6) : text);
};

describe('session-scoped HTTP MCP', () => {
    let cell: ReturnType<typeof createSessionCell>;
    let renderDiagram: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        renderDiagram = vi.fn(async () => ({
            data: '<svg/>',
            diagnostics: [],
            provenance: { kind: 'local' as const, rendererId: 'd2-worker', rendererLabel: 'D2', options: {} },
        }));
        cell = createSessionCell(new MemoryStorage(), { render: renderDiagram });
        await cell.fetch(new Request('https://cell/initialize', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
    });

    it('enforces Streamable HTTP origin and protocol-version boundaries', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session', cell, snapshotBaseUrl: 'https://diagrams.example/',
        });
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

        const foreignOrigin = await handler.fetch(new Request('https://diagrams.example/mcp/session', {
            method: 'POST',
            headers: {
                accept: 'application/json, text/event-stream',
                'content-type': 'application/json',
                origin: 'https://attacker.example',
                'mcp-protocol-version': '2025-11-25',
            },
            body,
        }));
        expect(foreignOrigin.status).toBe(403);

        const unsupportedVersion = await handler.fetch(new Request('https://diagrams.example/mcp/session', {
            method: 'POST',
            headers: {
                accept: 'application/json, text/event-stream',
                'content-type': 'application/json',
                'mcp-protocol-version': '2099-01-01',
            },
            body,
        }));
        expect(unsupportedVersion.status).toBe(400);

        const negotiated = await rpc(handler.fetch, 'initialize', {
            protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' },
        });
        expect(negotiated.result.protocolVersion).toBe('2025-11-25');
    });

    it('interoperates with the official Streamable HTTP client transport', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session', cell, snapshotBaseUrl: 'https://diagrams.example/',
        });
        const transport = new StreamableHTTPClientTransport(
            new URL('https://diagrams.example/mcp/session'),
            {
                fetch: (input, init) => {
                    const { signal: _signal, ...requestInit } = init || {};
                    return handler.fetch(new Request(String(input), requestInit));
                },
            },
        );
        const client = new Client(
            { name: 'neolesk-integration-test', version: '1.0.0' },
            { supportedProtocolVersions: ['2025-11-25'] },
        );

        await client.connect(transport);
        const listed = await client.listTools();
        expect(listed.tools.map((tool) => tool.name)).toContain('set_source');
        await client.close();
    });

    it('rejects an oversized MCP request before touching session presence', async () => {
        const fetchCell = vi.spyOn(cell, 'fetch');
        const handler = createSessionMcpHandler({
            sessionId: 'session', cell, snapshotBaseUrl: 'https://diagrams.example/',
            maxRequestBodyBytes: 64,
        });
        fetchCell.mockClear();

        const response = await handler.fetch(new Request('https://diagrams.example/mcp/session', {
            method: 'POST',
            headers: {
                accept: 'application/json, text/event-stream',
                'content-type': 'application/json',
                'mcp-protocol-version': '2025-11-25',
            },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'tools/call',
                params: { name: 'set_source', arguments: { source: 'x'.repeat(128) } },
            }),
        }));

        expect(response.status).toBe(413);
        expect(fetchCell).not.toHaveBeenCalled();
    });

    it('rejects protocol initialization when the session does not exist', async () => {
        const missingCell = { fetch: vi.fn(async () => new Response(JSON.stringify({ error: 'Session not found' }), {
            status: 404, headers: { 'content-type': 'application/json' },
        })) };
        const handler = createSessionMcpHandler({
            sessionId: 'missing', cell: missingCell, snapshotBaseUrl: 'https://diagrams.example/',
        });
        const response = await handler.fetch(new Request('https://diagrams.example/mcp/missing', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'initialize',
                params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
            }),
        }));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual(expect.objectContaining({ error: 'Session not found' }));
    });

    it('advertises full editor control without WebMCP', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session',
            cell,
            snapshotBaseUrl: 'https://diagrams.example/',
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

    it('rejects view settings outside the tool schema instead of clamping them', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session', cell, snapshotBaseUrl: 'https://diagrams.example/',
        });

        const changed = await rpc(handler.fetch, 'tools/call', {
            name: 'set_view_settings', arguments: { zoom: 99 },
        });

        expect(changed.result).toEqual(expect.objectContaining({ isError: true }));
        expect(changed.result.content[0].text).toContain('zoom must be between 0.25 and 4');
        const read = await rpc(handler.fetch, 'tools/call', {
            name: 'get_view_settings', arguments: {},
        });
        expect(read.result.structuredContent).toEqual({ settings: {} });
    });

    it('renders through the session cell and preserves structured failures', async () => {
        const handler = createSessionMcpHandler({
            sessionId: 'session',
            cell,
            snapshotBaseUrl: 'https://diagrams.example/',
        });
        const rendered = await rpc(handler.fetch, 'tools/call', {
            name: 'render', arguments: { format: 'svg' },
        });
        expect(rendered.result.structuredContent).toEqual(expect.objectContaining({
            data: '<svg/>',
            provenance: expect.objectContaining({ rendererId: 'd2-worker' }),
        }));
        expect(renderDiagram).toHaveBeenCalledWith(expect.objectContaining({
            renderServerUrl: 'https://diagrams.example/render/',
        }));

        const failing = createSessionCell(new MemoryStorage(), {
            render: async () => {
                throw new RenderingError('REMOTE_RENDER_FAILED', 'd2', 'bad source', [{
                    kind: 'render', rendererId: 'kroki', message: 'bad source', line: 3,
                }]);
            },
        });
        await failing.fetch(new Request('https://cell/initialize', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'bad' }),
        }));
        const failingHandler = createSessionMcpHandler({
            sessionId: 'session', cell: failing, snapshotBaseUrl: 'https://diagrams.example/',
        });
        const failed = await rpc(failingHandler.fetch, 'tools/call', {
            name: 'render', arguments: { format: 'svg' },
        });
        expect(failed.result).toEqual(expect.objectContaining({
            isError: true,
            structuredContent: expect.objectContaining({
                code: 'REMOTE_RENDER_FAILED',
                diagnostics: [expect.objectContaining({ line: 3 })],
            }),
        }));
    });

    it('returns one bounded binary representation for MCP exports', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const exportCell = {
            fetch: vi.fn(async (request: Request) => {
                const path = new URL(request.url).pathname;
                if (path === '/presence') return new Response(null, { status: 204 });
                if (path === '/export') return new Response(bytes, {
                    headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) },
                });
                return new Response('{}', { headers: { 'content-type': 'application/json' } });
            }),
        };
        const handler = createSessionMcpHandler({
            sessionId: 'session', cell: exportCell, snapshotBaseUrl: 'https://diagrams.example/',
            maxExportBytes: 4,
        });

        const exported = await rpc(handler.fetch, 'tools/call', {
            name: 'export', arguments: { format: 'png' },
        });

        expect(exported.result.content).toEqual([expect.objectContaining({
            type: 'image', mimeType: 'image/png', data: 'AQID',
        })]);
        expect(exported.result.structuredContent).toEqual({
            format: 'png', mimeType: 'image/png', byteLength: 3,
        });
        expect(JSON.stringify(exported.result).match(/AQID/g)).toHaveLength(1);
        const exportRequest = exportCell.fetch.mock.calls
            .map(([request]) => request as Request)
            .find((request) => new URL(request.url).pathname === '/export');
        expect(await exportRequest?.clone().json()).toEqual(expect.objectContaining({ maxBytes: 4 }));
    });

    it('rejects MCP exports above their smaller transport cap', async () => {
        const exportCell = {
            fetch: vi.fn(async (request: Request) => new URL(request.url).pathname === '/presence'
                ? new Response(null, { status: 204 })
                : new Response(new Uint8Array(5), {
                    headers: { 'content-type': 'image/png', 'content-length': '5' },
                })),
        };
        const handler = createSessionMcpHandler({
            sessionId: 'session', cell: exportCell, snapshotBaseUrl: 'https://diagrams.example/',
            maxExportBytes: 4,
        });

        const exported = await rpc(handler.fetch, 'tools/call', {
            name: 'export', arguments: { format: 'png' },
        });

        expect(exported.result).toEqual(expect.objectContaining({ isError: true }));
        expect(JSON.stringify(exported.result)).not.toContain('AAAA');
    });
});
