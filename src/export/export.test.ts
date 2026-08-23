import { describe, expect, it, vi } from 'vitest';
import {
    createManagedCellExportAdapter,
    createRemoteExportAdapter,
    createSessionExportAdapter,
    exportDiagram,
} from './export';
import { createKrokiRemoteRenderer } from '../rendering/remote';

describe('diagram export', () => {
    it('creates SVG entirely from the rendered browser result', async () => {
        const remoteExport = vi.fn();
        const result = await exportDiagram({
            format: 'svg',
            svg: '<svg><text>private</text></svg>',
            language: 'mermaid',
            source: 'private source',
            remote: null,
            remoteExport,
        });

        const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(result);
        });
        expect(text).toBe('<svg><text>private</text></svg>');
        expect(result.type).toBe('image/svg+xml');
        expect(remoteExport).not.toHaveBeenCalled();
    });

    it.each([
        ['png', 'image/png'],
        ['jpeg', 'image/jpeg'],
        ['pdf', 'application/pdf'],
    ] as const)('exports %s through the consented server', async (format, mimeType) => {
        const remoteExport = vi.fn(async () => new Blob(['binary'], { type: mimeType }));
        const remote = createKrokiRemoteRenderer({
            id: 'neolesk', label: "neolesk's renderer", url: 'https://example.test/render/',
        });

        const result = await exportDiagram({
            format,
            svg: '<svg />',
            language: 'mermaid',
            source: 'diagram source',
            remote,
            remoteExport,
        });

        expect(result.type).toBe(mimeType);
        expect(remoteExport).toHaveBeenCalledWith({
            format,
            language: 'mermaid',
            serverUrl: 'https://example.test/render/',
            source: 'diagram source',
        });
    });

    it('refuses network-backed exports without consent', async () => {
        await expect(exportDiagram({
            format: 'png',
            svg: '<svg />',
            language: 'mermaid',
            source: 'private source',
            remote: null,
            remoteExport: vi.fn(),
        })).rejects.toMatchObject({ code: 'REMOTE_CONSENT_REQUIRED' });
    });

    it('bounds a direct remote binary export response', async () => {
        const remoteExport = createRemoteExportAdapter(
            async () => new Response(new Uint8Array(128), { headers: { 'content-type': 'image/png' } }),
            { maxResponseBytes: 64 },
        );

        await expect(remoteExport({
            format: 'png', language: 'd2', source: 'a -> b', serverUrl: 'https://example.test/',
        })).rejects.toThrow('exceeds 64 bytes');
    });

    it('routes a live-session binary export through its cell with the selected renderer', async () => {
        const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/png' },
        }));
        const exportSession = createSessionExportAdapter({
            backendUrl: 'https://diagrams.example/',
            sessionId: 'a'.repeat(64),
            participantId: 'browser-stable',
            rendererId: 'kroki-io',
            fetchImpl,
        });

        const result = await exportSession({
            format: 'png', language: 'd2', source: 'ignored', serverUrl: 'https://kroki.io/',
        });

        expect(result.type).toBe('image/png');
        expect(fetchImpl).toHaveBeenCalledWith(
            `https://diagrams.example/api/sessions/${'a'.repeat(64)}/export`,
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    format: 'png', participantId: 'browser-stable', rendererId: 'kroki-io',
                }),
            }),
        );
    });

    it('routes a managed-workspace export through a temporary cell and closes it', async () => {
        const sessionId = 'b'.repeat(64);
        const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/api/sessions')) return new Response(JSON.stringify({ id: sessionId }), {
                status: 201, headers: { 'content-type': 'application/json' },
            });
            if (url.endsWith('/export')) return new Response(new Uint8Array([7, 8, 9]), {
                headers: { 'content-type': 'application/pdf' },
            });
            if (url.endsWith('/close')) return new Response(null, { status: 204 });
            return new Response('not found', { status: 404 });
        });
        const exportManaged = createManagedCellExportAdapter({
            backendUrl: 'https://diagrams.example/', rendererId: 'neolesk', fetchImpl,
        });

        const result = await exportManaged({
            format: 'pdf', language: 'plantuml', source: '@startuml\n@enduml',
            serverUrl: 'https://diagrams.example/render/',
        });

        expect(result.type).toBe('application/pdf');
        expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
            'https://diagrams.example/api/sessions',
            `https://diagrams.example/api/sessions/${sessionId}/export`,
            `https://diagrams.example/api/sessions/${sessionId}/close`,
        ]);
        expect(fetchImpl.mock.calls[0][1]).toEqual(expect.objectContaining({
            method: 'POST', body: JSON.stringify({ language: 'plantuml', source: '@startuml\n@enduml' }),
        }));
    });

    it.each([
        ['neolesk', 'https://diagrams.example/render/'],
        ['kroki-io', 'https://kroki.io/'],
    ])('uses the exact %s server that the user consented to', async (id, serverUrl) => {
        const remoteExport = vi.fn(async () => new Blob(['binary'], { type: 'image/png' }));

        await exportDiagram({
            format: 'png',
            svg: '<svg />',
            language: 'plantuml',
            source: '@startuml\n@enduml',
            remote: createKrokiRemoteRenderer({ id, label: id, url: serverUrl }),
            remoteExport,
        });

        expect(remoteExport).toHaveBeenCalledWith(expect.objectContaining({ serverUrl }));
    });
});
