export const parseSvgDimensions = (svgText: string): { width: number; height: number } | null => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    if (!svg) {
        return null;
    }

    const width = parseFloat(svg.getAttribute('width') || '');
    const height = parseFloat(svg.getAttribute('height') || '');

    if (width > 0 && height > 0) {
        return { width, height };
    }

    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] };
        }
    }

    return null;
};

export const createSvgBlobUrl = (svgText: string): string =>
    URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));

export const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
    });

export const getDimensions = async (
    svgText: string,
    blobUrl: string,
): Promise<{ width: number; height: number }> => {
    const parsed = parseSvgDimensions(svgText);
    if (parsed) return parsed;

    // Fallback: load as image and use naturalWidth/naturalHeight
    const img = await loadImage(blobUrl);
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        return { width: img.naturalWidth, height: img.naturalHeight };
    }

    return { width: 800, height: 600 };
};

/**
 * Render SVG to canvas using the browser's native <img> renderer.
 * Best quality — handles @font-face, CSS, complex SVG features perfectly.
 * Throws if the canvas is tainted (e.g. SVG contains <foreignObject>).
 */
const nativeSvgToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale: number,
): Promise<HTMLCanvasElement> => {
    const blobUrl = createSvgBlobUrl(svgText);
    try {
        const img = await loadImage(blobUrl);
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context not available');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);

        // Force taint check — throws SecurityError if tainted
        canvas.toDataURL();

        return canvas;
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
};

/**
 * Render SVG to canvas using canvg (JS-based SVG renderer).
 * Fallback for SVGs with <foreignObject> that taint the native canvas.
 * Lower quality than native but handles foreignObject content.
 */
const canvgSvgToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale: number,
): Promise<HTMLCanvasElement> => {
    const { Canvg } = await import('canvg');

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (scale !== 1) {
        ctx.scale(scale, scale);
    }

    const v = Canvg.fromString(ctx, svgText, {
        ignoreDimensions: true,
        scaleWidth: width,
        scaleHeight: height,
        ignoreClear: true,
    });
    await v.render();

    return canvas;
};

/**
 * Walk a DOM subtree and collect text, treating <br> and closing block-level
 * elements as line-break markers. Returns an array of non-empty trimmed lines.
 * This avoids the innerHTML round-trip that would strip null/sentinel chars.
 */
const collectLinesFromDom = (root: Element): string[] => {
    const lines: string[] = [];
    let current = '';

    const flush = () => {
        const trimmed = current.trim();
        if (trimmed) lines.push(trimmed);
        current = '';
    };

    const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            current += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tag = el.tagName.toUpperCase();
            if (tag === 'BR') {
                flush();
                return;
            }
            // Process children first, then flush on block close
            for (const child of el.childNodes) walk(child);
            if (BLOCK_TAGS.has(tag)) flush();
        }
    };

    walk(root);
    flush();
    return lines;
};

/**
 * Extract text lines from a foreignObject element, respecting both explicit
 * HTML line breaks (<br>) AND CSS word-wrapping (white-space: break-spaces).
 *
 * @param fo        - The <foreignObject> DOM element (must be in the live document)
 * @param foWidth   - Width to word-wrap within (pass Infinity to disable word-wrap)
 * @param measureCtx - Canvas 2D context configured with the correct font, for measuring text
 */
const extractForeignObjectLines = (
    fo: Element,
    foWidth: number,
    measureCtx: CanvasRenderingContext2D,
): string[] => {
    // Walk the DOM tree directly — avoids innerHTML round-trips that strip
    // control characters (e.g. HTML parsers discard the null byte \x00).
    const segments = collectLinesFromDom(fo);
    if (segments.length === 0) return [];

    const result: string[] = [];

    for (const segment of segments) {
        if (foWidth === Infinity) {
            // nowrap — emit as-is (explicit <br> already split it)
            result.push(segment);
            continue;
        }

        // Greedy word-wrap: add words until the line exceeds foWidth
        const words = segment.split(/\s+/).filter((w) => w.length > 0);
        let current = '';

        for (const word of words) {
            const test = current ? `${current} ${word}` : word;
            if (current && measureCtx.measureText(test).width > foWidth) {
                result.push(current);
                current = word;
            } else {
                current = test;
            }
        }
        if (current) result.push(current);
    }

    return result;
};

/**
 * Strip <foreignObject> elements from SVG, replacing them with SVG <text>
 * elements that use <tspan> per line. Handles both:
 *   - Explicit <br/> line breaks (e.g. Mermaid diamond labels with nowrap)
 *   - CSS word-wrap (white-space: break-spaces on rectangular node labels)
 * Text blocks are vertically centred within the foreignObject bounding box.
 */
const stripForeignObjects = (svgText: string): string => {
    if (svgText.indexOf('<foreignObject') === -1) return svgText;

    // Render in hidden container so computed styles and layout are available
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    // Canvas for measuring text width (used to simulate CSS word-wrap)
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d')!;

    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;

        for (const fo of svgEl.querySelectorAll('foreignObject')) {
            // x/y are usually null in Mermaid SVGs — positioning is via the parent
            // <g transform="translate(...)">. foX=0, foY=0 keeps us in the same
            // coordinate space as the foreignObject when we place the <text>.
            const foWidth = parseFloat(fo.getAttribute('width') || '0');
            const foHeight = parseFloat(fo.getAttribute('height') || '0');
            const foX = parseFloat(fo.getAttribute('x') || '0');
            const foY = parseFloat(fo.getAttribute('y') || '0');

            // Find the innermost text-containing element for computed styles.
            // Include inline formatting elements (b, strong, font, em, i) so that
            // getComputedStyle picks up colour from <font color="..."> and
            // font-weight from <b> / <strong> — not just the block-level ancestor.
            let styledEl: Element = fo;
            for (const el of fo.querySelectorAll('b, strong, font, em, i, span, p, div')) {
                if ((el.textContent || '').trim().length > 0) styledEl = el;
            }

            const computed = window.getComputedStyle(styledEl);
            const fontSize = parseFloat(computed.fontSize || '14');
            const cssLineHeight = parseFloat(computed.lineHeight);
            const lineHeight = isNaN(cssLineHeight) ? fontSize * 1.3 : cssLineHeight;

            // Configure canvas font to match computed styles for accurate measurement
            const fw = computed.fontWeight;
            const fs = computed.fontStyle;
            const ff = computed.fontFamily || 'sans-serif';
            const weightPart = fw && fw !== '400' && fw !== 'normal' ? `${fw} ` : '';
            const stylePart = fs && fs !== 'normal' ? `${fs} ` : '';
            measureCtx.font = `${stylePart}${weightPart}${fontSize}px ${ff}`;

            // Only word-wrap when CSS allows wrapping
            const whiteSpace = computed.whiteSpace;
            const wrapWidth = (whiteSpace === 'nowrap' || foWidth === 0) ? Infinity : foWidth;

            const lines = extractForeignObjectLines(fo, wrapWidth, measureCtx);
            if (lines.length === 0) { fo.remove(); continue; }

            const textAlign = computed.textAlign || 'center';
            const anchorMap: Record<string, string> = { start: 'start', left: 'start', end: 'end', right: 'end' };
            const textAnchor = anchorMap[textAlign] || 'middle';

            let x: number;
            if (textAnchor === 'start') x = foX + 4;
            else if (textAnchor === 'end') x = foX + foWidth - 4;
            else x = foX + foWidth / 2;

            // Vertically centre the line block within the foreignObject bounds
            const totalTextHeight = lines.length * lineHeight;
            const startY = foY + (foHeight - totalTextHeight) / 2 + lineHeight * 0.8;

            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('text-anchor', textAnchor);
            textEl.setAttribute('font-family', ff);
            textEl.setAttribute('font-size', String(fontSize));
            if (fw && fw !== '400' && fw !== 'normal') {
                textEl.setAttribute('font-weight', fw);
            }
            if (fs && fs !== 'normal') {
                textEl.setAttribute('font-style', fs);
            }
            // Use inline style for fill so it overrides the SVG's own <style> block
            // (e.g. Mermaid sets `fill: #333` on the root, which cascades to all
            // <text> elements and would beat a presentation-attribute `fill`).
            const fillColor = computed.color || 'rgb(0,0,0)';
            textEl.setAttribute('style', `fill:${fillColor}`);

            lines.forEach((line, i) => {
                const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspan.setAttribute('x', String(x));
                tspan.setAttribute('y', String(startY + i * lineHeight));
                tspan.textContent = line;
                textEl.appendChild(tspan);
            });

            // Edge labels (arrow text) need a light background so the text
            // reads clearly over the arrow line — replicate the labelBkg style.
            const isEdgeLabel = fo.querySelector('.edgeLabel') !== null;

            if (isEdgeLabel && foWidth > 0 && foHeight > 0) {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                const pad = 3;
                rect.setAttribute('x', String(foX - pad));
                rect.setAttribute('y', String(foY - 1));
                rect.setAttribute('width', String(foWidth + pad * 2));
                rect.setAttribute('height', String(foHeight + 2));
                rect.setAttribute('fill', '#ececf8');
                rect.setAttribute('rx', '2');
                g.appendChild(rect);
                g.appendChild(textEl);
                fo.parentNode?.replaceChild(g, fo);
            } else {
                fo.parentNode?.replaceChild(textEl, fo);
            }
        }

        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
};

/** Target ~300 DPI at 8" print width (2400px long edge), capped to avoid huge canvases. */
export const printScale = (width: number, height: number): number => {
    const targetLongEdge = 2400;
    const maxScale = 8;
    const longEdge = Math.max(width, height);
    return Math.min(maxScale, Math.max(1, targetLongEdge / longEdge));
};

/**
 * Render SVG to canvas with three-tier fallback:
 *   1. Native <img>→canvas (best quality, handles @font-face/CSS)
 *      Skipped when SVG contains <foreignObject>: browsers silently omit
 *      foreignObject HTML content when SVG is loaded as <img>, producing a
 *      canvas with no text. The blob URL does not taint the canvas so the
 *      SecurityError check never fires — we must detect this case explicitly.
 *   2. canvg (JS renderer)
 *      Skipped when SVG contains <foreignObject>: canvg also silently drops
 *      HTML content inside <foreignObject>, returning a canvas with no text.
 *   3. Strip <foreignObject>→<text>, then native canvas
 *      (browser renders @font-face correctly; foreignObject text is extracted
 *       via computed styles and replaced with SVG <text> elements — this is the
 *       correct path for Mermaid and any other diagram that uses foreignObject
 *       for HTML node labels)
 */
export const svgToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale = 1,
): Promise<HTMLCanvasElement> => {
    const hasForeignObject = svgText.indexOf('<foreignObject') !== -1;

    // Tier 1: native browser rendering (best quality).
    // Skip when <foreignObject> is present — browsers drop its HTML content
    // when SVG is rendered as <img>, resulting in a canvas with no text.
    if (!hasForeignObject) {
        try {
            return await nativeSvgToCanvas(svgText, width, height, scale);
        } catch {
            // Tainted — cross-origin resources in SVG
        }
    }

    // Tier 2: canvg (handles most SVG features, but NOT HTML inside foreignObject).
    // Skip when <foreignObject> is present for the same reason as Tier 1.
    if (!hasForeignObject) {
        try {
            return await canvgSvgToCanvas(svgText, width, height, scale);
        } catch {
            // canvg failed
        }
    }

    // Tier 3: strip foreignObject → <text>, then native canvas.
    // This is the correct path for SVGs with <foreignObject> (Mermaid, D2, etc.).
    // stripForeignObjects renders the SVG in a hidden DOM container, reads
    // computed styles from each foreignObject's HTML content, and replaces
    // each foreignObject with a native SVG <text> element — preserving labels.
    const stripped = stripForeignObjects(svgText);
    return nativeSvgToCanvas(stripped, width, height, scale);
};

export const exportBlob = (
    canvas: HTMLCanvasElement,
    format: 'image/png' | 'image/jpeg',
    quality?: number,
): Promise<Blob> =>
    new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
            format,
            quality,
        );
    });

export const exportPdf = async (
    svgText: string,
    width: number,
    height: number,
): Promise<Blob> => {
    const { jsPDF } = await import('jspdf');

    // Always use raster PDF via three-tier canvas rendering.
    // svg2pdf.js silently drops text for many diagram types
    // (Mermaid, D2, Pikchr) and throws for others (PlantUML).
    const canvas = await svgToCanvas(svgText, width, height, printScale(width, height));
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    const orientation = width > height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [width, height] });
    pdf.addImage(dataUrl, 'JPEG', 0, 0, width, height);
    return pdf.output('blob');
};

export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

export const downloadSvg = (svgText: string, filename: string): void => {
    downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), filename);
};
