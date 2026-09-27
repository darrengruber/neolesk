/**
 * PNG, JPEG and PDF made on this device from the SVG the preview shows
 * (ADR 0021). The preview is an <img> of that SVG, so a canvas draws exactly
 * what the person sees. Two things stop it:
 *
 * - HTML labels (<foreignObject>): every browser taints the canvas, and the
 *   export fails with a SecurityError. Mermaid can draw its labels as plain
 *   SVG text instead, so it is drawn again for the export.
 * - Images or fonts from another site: an SVG drawn as an image is sandboxed
 *   and cannot load them.
 *
 * Anything else is drawn here. The caller falls back to the render server.
 */
import { xmlSafeSvg } from '../utils/svgXml';

export type RasterFormat = 'png' | 'jpeg' | 'pdf';

export interface LocalExporter {
    /** An SVG this device can draw for export, or why it cannot. */
    prepare(input: { svg: string; language: string; source: string }): Promise<{ svg: string } | { reason: string }>;
    export(svg: string, format: RasterFormat): Promise<Blob>;
}

export interface PixelSize {
    width: number;
    height: number;
}

const HTML_LABELS = 'it uses HTML labels';
const EXTERNAL = 'it links images or fonts from another site';
const INVALID = 'its SVG is not valid XML';

const XLINK = 'http://www.w3.org/1999/xlink';
const isRemoteUrl = (value: string) => /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) && !/^\s*data:/i.test(value);
const cssLinksRemote = (css: string) => (
    /@import\b/i.test(css)
    || Array.from(css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)).some((match) => isRemoteUrl(match[2]))
);

const parse = (svg: string): Element | null => {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = document.documentElement;
    if (!root || root.localName !== 'svg' || document.getElementsByTagName('parsererror').length > 0) return null;
    return root;
};

export const rasterBlockers = (svg: string): string[] => {
    const root = parse(svg);
    if (!root) return [INVALID];
    const reasons: string[] = [];
    if (root.getElementsByTagNameNS('*', 'foreignObject').length > 0) reasons.push(HTML_LABELS);
    const links = Array.from(root.querySelectorAll('*')).some((element) => {
        const href = element.getAttribute('href') ?? element.getAttributeNS(XLINK, 'href') ?? '';
        if (href && isRemoteUrl(href)) return true;
        const style = element.getAttribute('style') ?? '';
        return (element.localName === 'style' && cssLinksRemote(element.textContent ?? '')) || cssLinksRemote(style);
    });
    if (links) reasons.push(EXTERNAL);
    return reasons;
};

const CSS_PIXELS: Record<string, number> = {
    '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6,
};

const lengthInPixels = (value: string | null): number | null => {
    const match = value?.trim().match(/^([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-z]*)$/i);
    const factor = match ? CSS_PIXELS[match[2].toLowerCase()] : undefined;
    if (!match || factor === undefined) return null;
    const pixels = Number(match[1]) * factor;
    return pixels > 0 ? pixels : null;
};

const viewBoxOf = (root: Element): number[] | null => {
    const values = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    return values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0 ? values : null;
};

/** The diagram's size in CSS pixels, as the preview draws it. */
export const svgPixelSize = (svg: string): PixelSize | null => {
    const root = parse(svg);
    if (!root) return null;
    const width = lengthInPixels(root.getAttribute('width'));
    const height = lengthInPixels(root.getAttribute('height'));
    if (width && height) return { width, height };
    const viewBox = viewBoxOf(root);
    return viewBox ? { width: viewBox[2], height: viewBox[3] } : null;
};

const round = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * Pin the root to a pixel size. Without a viewBox the drawing would be cropped
 * at the new size instead of scaled, so the old size becomes the viewBox.
 */
export const withPixelSize = (svg: string, size: PixelSize): string => {
    const root = parse(svg);
    if (!root) return svg;
    if (!viewBoxOf(root)) {
        const width = Number.parseFloat(root.getAttribute('width') ?? '') || size.width;
        const height = Number.parseFloat(root.getAttribute('height') ?? '') || size.height;
        root.setAttribute('viewBox', `0 0 ${round(width)} ${round(height)}`);
    }
    root.setAttribute('width', round(size.width));
    root.setAttribute('height', round(size.height));
    return new XMLSerializer().serializeToString(root);
};

// Safari refuses a canvas above 16,777,216 pixels; Chromium above 32,767 on a side.
const MAX_PIXELS = 16_777_216;
const MAX_SIDE = 16_384;

// Just under each limit, so rounding cannot step over it.
const MARGIN = 1 - 1e-9;

export const rasterScale = (size: PixelSize, desired: number): number => Math.min(
    desired,
    Math.sqrt(MAX_PIXELS / (size.width * size.height)) * MARGIN,
    (MAX_SIDE / size.width) * MARGIN,
    (MAX_SIDE / size.height) * MARGIN,
);

export const deflate = async (bytes: Uint8Array): Promise<Uint8Array> => {
    // "deflate" is the zlib format, which is exactly PDF's FlateDecode.
    const stream = new ReadableStream<BufferSource>({
        start(controller) {
            controller.enqueue(Uint8Array.from(bytes));
            controller.close();
        },
    }).pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

// PDF readers accept pages up to 200 inches (14,400 points) on a side.
const MAX_PAGE_POINTS = 14_400;

/** A one-page PDF that shows a lossless RGB picture over the whole page. */
export const buildImagePdf = async ({
    pageWidth,
    pageHeight,
    pixelWidth,
    pixelHeight,
    rgb,
}: {
    pageWidth: number;
    pageHeight: number;
    pixelWidth: number;
    pixelHeight: number;
    /** Deflated RGB samples, 8 bits each, row by row. */
    rgb: Uint8Array;
}): Promise<Uint8Array> => {
    const fit = Math.min(1, MAX_PAGE_POINTS / pageWidth, MAX_PAGE_POINTS / pageHeight);
    const width = round(pageWidth * fit);
    const height = round(pageHeight * fit);
    const encoder = new TextEncoder();
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
    const objects: (string | [string, Uint8Array])[] = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
        [`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${rgb.length} >>`, rgb],
        [`<< /Length ${content.length} >>`, encoder.encode(content)],
    ];
    const parts: Uint8Array[] = [];
    let length = 0;
    const push = (part: string | Uint8Array) => {
        const bytes = typeof part === 'string' ? encoder.encode(part) : part;
        parts.push(bytes);
        length += bytes.length;
    };
    push('%PDF-1.4\n');
    // A comment of bytes above 127 tells transfer tools the file is binary.
    push(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(length);
        if (typeof object === 'string') {
            push(`${index + 1} 0 obj\n${object}\nendobj\n`);
        } else {
            push(`${index + 1} 0 obj\n${object[0]}\nstream\n`);
            push(object[1]);
            push('\nendstream\nendobj\n');
        }
    });
    const xref = length;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    offsets.forEach((offset) => push(`${String(offset).padStart(10, '0')} 00000 n \n`));
    push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const pdf = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
        pdf.set(part, at);
        at += part.length;
    }
    return pdf;
};

const loadImage = async (svg: string): Promise<HTMLImageElement> => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    } finally {
        // The decoded image keeps its pixels after the URL goes.
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
};

const drawSvg = async (svg: string, scale: number, background: string | null) => {
    const size = svgPixelSize(svg) ?? { width: 800, height: 600 };
    const image = await loadImage(withPixelSize(svg, size));
    const factor = rasterScale(size, scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(size.width * factor));
    canvas.height = Math.max(1, Math.floor(size.height * factor));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw the diagram for export');
    if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, context, size };
};

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
    // A tainted canvas throws a SecurityError here.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image'))), type, quality);
});

// PNG and JPEG at twice the CSS size stay sharp on high-density screens; the
// PDF picture at three times prints at 216 dots per inch.
const PNG_SCALE = 2;
const PDF_SCALE = 3;

const exportRaster = async (svg: string, format: RasterFormat): Promise<Blob> => {
    if (format === 'png') {
        const { canvas } = await drawSvg(svg, PNG_SCALE, null);
        return canvasBlob(canvas, 'image/png');
    }
    if (format === 'jpeg') {
        const { canvas } = await drawSvg(svg, PNG_SCALE, '#ffffff');
        return canvasBlob(canvas, 'image/jpeg', 0.92);
    }
    const { canvas, context, size } = await drawSvg(svg, PDF_SCALE, '#ffffff');
    // getImageData throws the same SecurityError as toBlob on a tainted canvas.
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
        rgb[target] = rgba[source];
        rgb[target + 1] = rgba[source + 1];
        rgb[target + 2] = rgba[source + 2];
    }
    const pdf = await buildImagePdf({
        // 96 CSS pixels are one inch, which is 72 points.
        pageWidth: size.width * 0.75,
        pageHeight: size.height * 0.75,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        rgb: await deflate(rgb),
    });
    return new Blob([Uint8Array.from(pdf)], { type: 'application/pdf' });
};

/**
 * Whether the Share sheet offers PNG, JPEG and PDF from this device. Mermaid
 * counts because it draws plain labels for export; the rare Mermaid type that
 * keeps HTML labels falls back to the render server when the person exports.
 */
export const mayExportOnDevice = (svg: string | null, language: string): boolean => {
    if (!svg) return false;
    const reasons = rasterBlockers(svg);
    return reasons.length === 0 || (language === 'mermaid' && reasons.every((reason) => reason === HTML_LABELS));
};

const renderMermaidPlainLabels = async (source: string): Promise<string> => (
    (await import('../engines/mermaid')).renderPlainLabels(source)
);

export const createBrowserLocalExporter = (dependencies: {
    renderMermaidPlainLabels?: (source: string) => Promise<string>;
} = {}): LocalExporter => {
    const drawMermaid = dependencies.renderMermaidPlainLabels ?? renderMermaidPlainLabels;
    return {
        async prepare({ svg, language, source }) {
            let candidate = svg;
            let reasons = rasterBlockers(candidate);
            if (language === 'mermaid' && reasons.includes(HTML_LABELS)) {
                candidate = xmlSafeSvg(await drawMermaid(source));
                reasons = rasterBlockers(candidate);
            }
            return reasons.length === 0 ? { svg: candidate } : { reason: reasons[0] };
        },
        export: exportRaster,
    };
};
