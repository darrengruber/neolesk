import { describe, expect, it, vi } from 'vitest';
import {
    buildImagePdf,
    createBrowserLocalExporter,
    deflate,
    deviceExportHint,
    rasterBlockers,
    rasterScale,
    svgPixelSize,
    withPixelSize,
} from './localExport';

const svg = (body = '', attributes = 'width="200" height="100"') => (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attributes}>${body}</svg>`
);
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('what stops this device from drawing an SVG onto a canvas', () => {
    it('finds nothing in a plain SVG, including embedded images and fonts', () => {
        expect(rasterBlockers(svg('<text font-family="Arial">a</text>'))).toEqual([]);
        expect(rasterBlockers(svg('<image href="data:image/png;base64,AAAA"/><use href="#a"/>'))).toEqual([]);
        expect(rasterBlockers(svg('<style>@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA)}</style>'))).toEqual([]);
    });

    it('names HTML labels, which taint the canvas in every browser', () => {
        const mermaid = svg('<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">A</div></foreignObject>');
        expect(rasterBlockers(mermaid)).toEqual(['it uses HTML labels']);
    });

    it('names images and fonts from another site, which a sandboxed image cannot load', () => {
        expect(rasterBlockers(svg('<image xlink:href="https://example.test/a.png"/>'))).toEqual(['it links images or fonts from another site']);
        expect(rasterBlockers(svg('<image href="//example.test/a.png"/>'))).toEqual(['it links images or fonts from another site']);
        expect(rasterBlockers(svg('<style>@import url("https://fonts.example/a.css");</style>'))).toEqual(['it links images or fonts from another site']);
        expect(rasterBlockers(svg('<style>@font-face{src:url(https://fonts.example/a.woff2)}</style>'))).toEqual(['it links images or fonts from another site']);
    });

    it('does not count links: a canvas draws a diagram whose shapes link elsewhere', () => {
        // Graphviz URL=, PlantUML links and Mermaid click all write <a href>.
        expect(rasterBlockers(svg('<a href="https://example.test/"><text>a</text></a>'))).toEqual([]);
        expect(rasterBlockers(svg('<a xlink:href="https://example.test/"><text>a</text></a>'))).toEqual([]);
    });

    it('names a paint or filter from another site', () => {
        expect(rasterBlockers(svg('<rect fill="url(https://example.test/p.svg#g)"/>'))).toEqual(['it links images or fonts from another site']);
        expect(rasterBlockers(svg('<rect fill="url(#local)"/>'))).toEqual([]);
    });

    it('refuses SVG that is not valid XML', () => {
        expect(rasterBlockers('<svg><text>&nbsp;</text></svg>')).toEqual(['its SVG is not valid XML']);
    });
});

describe('the size of a diagram in CSS pixels', () => {
    it('reads pixel, unitless and physical units', () => {
        expect(svgPixelSize(svg('', 'width="200" height="100"'))).toEqual({ width: 200, height: 100 });
        expect(svgPixelSize(svg('', 'width="200px" height="100px"'))).toEqual({ width: 200, height: 100 });
        // Graphviz sizes its output in points: 1pt is 4/3 CSS pixels.
        expect(svgPixelSize(svg('', 'width="72pt" height="36pt"'))).toEqual({ width: 96, height: 48 });
        expect(svgPixelSize(svg('', 'width="1in" height="2.54cm"'))).toEqual({ width: 96, height: 96 });
    });

    it('falls back to the viewBox when the size is relative or missing', () => {
        expect(svgPixelSize(svg('', 'width="100%" height="100%" viewBox="0 0 640 480"'))).toEqual({ width: 640, height: 480 });
        expect(svgPixelSize(svg('', 'viewBox="-10 -10 300 150"'))).toEqual({ width: 300, height: 150 });
        expect(svgPixelSize(svg('', ''))).toBeNull();
    });

    it('writes an explicit pixel size, so every browser draws the image at that size', () => {
        const sized = withPixelSize(svg('<g/>', 'width="72pt" height="36pt" viewBox="0 0 72 36"'), { width: 96, height: 48 });
        const root = new DOMParser().parseFromString(sized, 'image/svg+xml').documentElement;
        expect(root.getAttribute('width')).toBe('96');
        expect(root.getAttribute('height')).toBe('48');
        expect(root.getAttribute('viewBox')).toBe('0 0 72 36');
    });

    it('adds a viewBox in CSS pixels when it pins the size, so the drawing scales and is not cropped', () => {
        // Without a viewBox one user unit is one CSS pixel: a 72pt-wide SVG draws 96 units across.
        const sized = withPixelSize(svg('<rect width="96" height="48"/>', 'width="72pt" height="36pt"'), { width: 96, height: 48 });
        const root = new DOMParser().parseFromString(sized, 'image/svg+xml').documentElement;
        expect(root.getAttribute('viewBox')).toBe('0 0 96 48');
    });
});

describe('the raster scale', () => {
    it('uses the requested scale for an ordinary diagram', () => {
        expect(rasterScale({ width: 800, height: 600 }, 2)).toBe(2);
    });

    it('stays inside the largest canvas that every browser allows', () => {
        // Safari refuses a canvas above 16,777,216 pixels.
        const scale = rasterScale({ width: 4000, height: 3000 }, 3);
        expect(4000 * scale * 3000 * scale).toBeLessThanOrEqual(16_777_216);
        expect(rasterScale({ width: 30000, height: 100 }, 2) * 30000).toBeLessThanOrEqual(16_384);
    });
});

describe('a PDF built on this device', () => {
    it('holds one page of the diagram size with the image as a lossless picture', async () => {
        const rgb = new Uint8Array(2 * 1 * 3).fill(255);
        const pdf = await buildImagePdf({
            pageWidth: 150, pageHeight: 75, pixelWidth: 2, pixelHeight: 1, rgb: await deflate(rgb),
        });
        const body = text(pdf);

        expect(body.startsWith('%PDF-1.4\n')).toBe(true);
        expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
        expect(body).toContain('/MediaBox [0 0 150 75]');
        expect(body).toContain('/Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode');
        expect(body).toContain('150 0 0 75 0 0 cm /Im0 Do');
    });

    it('has a cross-reference table whose offsets point at each object', async () => {
        const pdf = await buildImagePdf({
            pageWidth: 10, pageHeight: 10, pixelWidth: 1, pixelHeight: 1, rgb: await deflate(new Uint8Array(3)),
        });
        const body = text(pdf);
        const startxref = Number(body.match(/startxref\n(\d+)\n/)?.[1]);
        expect(body.slice(startxref, startxref + 4)).toBe('xref');
        const offsets = body.slice(startxref).match(/^\d{10} 00000 n $/gm)!.map((line) => Number(line.slice(0, 10)));
        expect(offsets).toHaveLength(5);
        offsets.forEach((offset, index) => {
            expect(body.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
        });
    });

    it('keeps the page inside the largest size PDF readers accept', async () => {
        const pdf = await buildImagePdf({
            pageWidth: 30000, pageHeight: 15000, pixelWidth: 1, pixelHeight: 1, rgb: await deflate(new Uint8Array(3)),
        });
        expect(text(pdf)).toContain('/MediaBox [0 0 14400 7200]');
    });
});

describe('the browser exporter', () => {
    it('keeps an SVG that it can draw', async () => {
        const exporter = createBrowserLocalExporter({ renderMermaidPlainLabels: vi.fn() });
        const plain = svg('<text>a</text>');
        await expect(exporter.prepare({ svg: plain, language: 'graphviz', source: 'digraph {}' })).resolves.toEqual({ svg: plain });
    });

    it('draws Mermaid again with plain SVG labels when the preview uses HTML labels', async () => {
        const renderMermaidPlainLabels = vi.fn(async () => svg('<text>After the fix&nbsp;</text>'));
        const exporter = createBrowserLocalExporter({ renderMermaidPlainLabels });
        const prepared = await exporter.prepare({
            svg: svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">A</div></foreignObject>'),
            language: 'mermaid',
            source: 'graph TD\n A --> B',
        });

        expect(renderMermaidPlainLabels).toHaveBeenCalledWith('graph TD\n A --> B');
        // The engine's HTML entities become valid XML (issue #9).
        expect(prepared).toEqual({ svg: svg('<text>After the fix&#160;</text>') });
    });

    it('explains why it cannot draw a Mermaid type that keeps HTML labels', async () => {
        const exporter = createBrowserLocalExporter({
            renderMermaidPlainLabels: vi.fn(async () => svg('<foreignObject/>')),
        });
        await expect(exporter.prepare({ svg: svg('<foreignObject/>'), language: 'mermaid', source: 'journey' }))
            .resolves.toEqual({ reason: 'it uses HTML labels' });
    });

    it('does not draw other languages again: their HTML labels stay a reason', async () => {
        const renderMermaidPlainLabels = vi.fn();
        const exporter = createBrowserLocalExporter({ renderMermaidPlainLabels });
        await expect(exporter.prepare({ svg: svg('<foreignObject/>'), language: 'd2', source: 'a: |md # A|' }))
            .resolves.toEqual({ reason: 'it uses HTML labels' });
        expect(renderMermaidPlainLabels).not.toHaveBeenCalled();
    });
});

describe('what the Share sheet can tell from the SVG alone', () => {
    it('says yes for an SVG this device can draw', () => {
        expect(deviceExportHint(svg('<text>a</text>'), 'graphviz')).toBe('yes');
    });

    it('asks the exporter for Mermaid with HTML labels, which must be drawn again to know', () => {
        expect(deviceExportHint(svg('<foreignObject/>'), 'mermaid')).toBe('check');
    });

    it('says no when HTML labels or linked files stop the canvas for good', () => {
        expect(deviceExportHint(svg('<foreignObject/>'), 'd2')).toBe('no');
        expect(deviceExportHint(svg('<image href="https://example.test/a.png"/>'), 'mermaid')).toBe('no');
        expect(deviceExportHint(null, 'graphviz')).toBe('no');
    });
});

describe('the Mermaid export renderer', () => {
    it('tries again after a failed load instead of keeping the failure', async () => {
        vi.resetModules();
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
            .mockResolvedValue({ render: async () => '<svg/>' });
        const { renderPlainLabelsWith } = await import('../engines/mermaid');
        const render = renderPlainLabelsWith(load);
        await expect(render('graph TD')).rejects.toThrow('Failed to fetch');
        await expect(render('graph TD')).resolves.toBe('<svg/>');
        expect(load).toHaveBeenCalledTimes(2);
    });
});
