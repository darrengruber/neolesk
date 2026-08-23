import { describe, expect, it, vi } from 'vitest';
import { exportDiagram } from './export';

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
        const remote = { id: 'neolesk', label: "neolesk's renderer", url: 'https://example.test/render/' };

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
});
