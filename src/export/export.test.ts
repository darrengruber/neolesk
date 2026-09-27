import { describe, expect, it, vi } from 'vitest';
import {
    createManagedCellExportAdapter,
    createRemoteExportAdapter,
    createSessionExportAdapter,
    exportDiagram,
} from './export';
import { createKrokiRemoteRenderer } from '../rendering/remote';

// jsdom's Blob has no text(); read it the way a page does.
const blobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
});

describe('diagram export', () => {
    it('creates SVG entirely from the rendered browser result', async () => {
        const remoteExport = vi.fn();
        const { blob: result, madeOn } = await exportDiagram({
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
        expect(madeOn).toBe('device');
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

        const { blob: result, madeOn } = await exportDiagram({
            format,
            svg: '<svg />',
            language: 'graphviz',
            source: 'diagram source',
            remote,
            remoteExport,
        });

        expect(result.type).toBe(mimeType);
        expect(madeOn).toBe('server');
        expect(remoteExport).toHaveBeenCalledWith({
            format,
            language: 'graphviz',
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

    it.each([
        ['d2', 'png'],
        ['mermaid', 'pdf'],
        ['plantuml', 'jpeg'],
    ] as const)('does not ask the server for a %s %s export that it cannot make', async (language, format) => {
        const remoteExport = vi.fn();
        await expect(exportDiagram({
            format,
            svg: '<svg />',
            language,
            source: 'diagram source',
            remote: createKrokiRemoteRenderer({ id: 'neolesk', label: 'neolesk', url: 'https://example.test/render/' }),
            remoteExport,
        })).rejects.toThrow(`${format.toUpperCase()} export is not available for this diagram language`);
        expect(remoteExport).not.toHaveBeenCalled();
    });

    it('shows the message of a JSON error from the export cell, not the JSON', async () => {
        const exportSession = createSessionExportAdapter({
            backendUrl: 'https://diagrams.example/',
            sessionId: 'a'.repeat(64),
            participantId: 'browser-stable',
            rendererId: 'neolesk',
            fetchImpl: async () => new Response(JSON.stringify({ error: 'Session export rate limit exceeded' }), {
                status: 429, headers: { 'content-type': 'application/json' },
            }),
        });
        await expect(exportSession({
            format: 'png', language: 'graphviz', source: 'ignored', serverUrl: '',
        })).rejects.toThrow(/^Session export rate limit exceeded$/);

        const exportManaged = createManagedCellExportAdapter({
            backendUrl: 'https://diagrams.example/',
            rendererId: 'neolesk',
            fetchImpl: async () => new Response(JSON.stringify({ error: 'Session creation rate limit exceeded' }), {
                status: 429, headers: { 'content-type': 'application/json' },
            }),
        });
        await expect(exportManaged({
            format: 'png', language: 'graphviz', source: 'digraph {}', serverUrl: '',
        })).rejects.toThrow(/^Session creation rate limit exceeded$/);
    });

    describe('on this device first', () => {
        const server = createKrokiRemoteRenderer({ id: 'neolesk', label: 'neolesk', url: 'https://example.test/render/' });
        const localExporter = (prepared: { svg: string } | { reason: string }, exportImpl?: () => Promise<Blob>) => ({
            prepare: vi.fn(async () => prepared),
            export: vi.fn(exportImpl ?? (async () => new Blob(['local'], { type: 'image/png' }))),
        });

        it.each(['png', 'jpeg', 'pdf'] as const)('makes %s locally and never calls the server, even when it has consent', async (format) => {
            const local = localExporter({ svg: '<svg id="drawn"/>' });
            const remoteExport = vi.fn();
            const { blob, madeOn } = await exportDiagram({
                format, svg: '<svg/>', language: 'graphviz', source: 'digraph {}', remote: server, remoteExport, local,
            });
            expect(await blobText(blob)).toBe('local');
            expect(madeOn).toBe('device');
            expect(local.prepare).toHaveBeenCalledWith({ svg: '<svg/>', language: 'graphviz', source: 'digraph {}' });
            expect(local.export).toHaveBeenCalledWith('<svg id="drawn"/>', format);
            expect(remoteExport).not.toHaveBeenCalled();
        });

        it('makes a format locally that the server cannot make for the language', async () => {
            const local = localExporter({ svg: '<svg/>' });
            await expect(exportDiagram({
                format: 'pdf', svg: '<svg/>', language: 'mermaid', source: 'graph TD', remote: server, remoteExport: vi.fn(), local,
            })).resolves.toMatchObject({ madeOn: 'device' });
        });

        it('needs no consent for a local export', async () => {
            const local = localExporter({ svg: '<svg/>' });
            await expect(exportDiagram({
                format: 'png', svg: '<svg/>', language: 'graphviz', source: 'digraph {}', remote: null, remoteExport: vi.fn(), local,
            })).resolves.toMatchObject({ madeOn: 'device' });
        });

        it('uses the consented server when this device cannot draw the diagram', async () => {
            const local = localExporter({ reason: 'it uses HTML labels' });
            const remoteExport = vi.fn(async () => new Blob(['server'], { type: 'image/png' }));
            const { blob, madeOn } = await exportDiagram({
                format: 'png', svg: '<svg/>', language: 'graphviz', source: 'digraph {}', remote: server, remoteExport, local,
            });
            expect(await blobText(blob)).toBe('server');
            expect(madeOn).toBe('server');
            expect(local.export).not.toHaveBeenCalled();
        });

        it('uses the consented server when the canvas refuses the drawing', async () => {
            const local = localExporter({ svg: '<svg/>' }, async () => { throw new DOMException('Tainted canvas', 'SecurityError'); });
            const remoteExport = vi.fn(async () => new Blob(['server'], { type: 'image/png' }));
            const { blob, madeOn } = await exportDiagram({
                format: 'png', svg: '<svg/>', language: 'graphviz', source: 'digraph {}', remote: server, remoteExport, local,
            });
            expect(await blobText(blob)).toBe('server');
            expect(madeOn).toBe('server');
        });

        it('gives a plain reason, not the browser message, when the canvas fails without consent', async () => {
            const local = localExporter({ svg: '<svg/>' }, async () => { throw new DOMException('The source image cannot be decoded.', 'EncodingError'); });
            await expect(exportDiagram({
                format: 'jpeg', svg: '<svg/>', language: 'graphviz', source: 'digraph {}', remote: null, remoteExport: vi.fn(), local,
            })).rejects.toMatchObject({
                message: 'JPEG export of this diagram needs a render server, because this browser could not draw it',
            });
        });

        it('says why a render server is needed when there is no consent', async () => {
            const local = localExporter({ reason: 'it uses HTML labels' });
            await expect(exportDiagram({
                format: 'png', svg: '<svg/>', language: 'mermaid', source: 'journey', remote: null, remoteExport: vi.fn(), local,
            })).rejects.toMatchObject({
                code: 'REMOTE_CONSENT_REQUIRED',
                message: 'PNG export of this diagram needs a render server, because it uses HTML labels',
            });
        });
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
