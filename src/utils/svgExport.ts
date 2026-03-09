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
 * Strip <foreignObject> elements from SVG, replacing them with simple
 * <text> elements that preserve the text content and computed styles.
 * This allows the browser's native canvas path to render @font-face fonts
 * correctly while avoiding canvas tainting.
 */
const stripForeignObjects = (svgText: string): string => {
    if (svgText.indexOf('<foreignObject') === -1) return svgText;

    // Render in hidden container to resolve CSS cascade for computed styles
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;

        for (const fo of svgEl.querySelectorAll('foreignObject')) {
            const text = (fo.textContent || '').trim();
            if (!text) { fo.remove(); continue; }

            // Find the innermost text-containing element for computed styles
            let styledEl: Element = fo;
            for (const el of fo.querySelectorAll('span, p, div')) {
                if ((el.textContent || '').trim().length > 0) styledEl = el;
            }

            const computed = window.getComputedStyle(styledEl);
            const foWidth = parseFloat(fo.getAttribute('width') || fo.style.getPropertyValue('width') || '0');
            const foHeight = parseFloat(fo.getAttribute('height') || fo.style.getPropertyValue('height') || '0');
            const foX = parseFloat(fo.getAttribute('x') || '0');
            const foY = parseFloat(fo.getAttribute('y') || '0');

            const textAlign = computed.textAlign || 'center';
            const anchorMap: Record<string, string> = { start: 'start', left: 'start', end: 'end', right: 'end' };
            const textAnchor = anchorMap[textAlign] || 'middle';

            let x: number;
            if (textAnchor === 'start') x = foX + 2;
            else if (textAnchor === 'end') x = foX + foWidth - 2;
            else x = foX + foWidth / 2;

            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('x', String(x));
            textEl.setAttribute('y', String(foY + foHeight / 2));
            textEl.setAttribute('text-anchor', textAnchor);
            textEl.setAttribute('dominant-baseline', 'central');
            textEl.setAttribute('font-family', computed.fontFamily || 'sans-serif');
            textEl.setAttribute('font-size', computed.fontSize || '16px');
            if (computed.fontWeight && computed.fontWeight !== '400' && computed.fontWeight !== 'normal') {
                textEl.setAttribute('font-weight', computed.fontWeight);
            }
            if (computed.fontStyle && computed.fontStyle !== 'normal') {
                textEl.setAttribute('font-style', computed.fontStyle);
            }
            textEl.setAttribute('fill', computed.color || 'rgb(0,0,0)');
            textEl.textContent = text;
            fo.parentNode?.replaceChild(textEl, fo);
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
 *   2. canvg (JS renderer, handles <foreignObject>)
 *   3. Strip <foreignObject>→<text>, then native canvas
 *      (handles @font-face + foreignObject combo, e.g. D2)
 */
export const svgToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale = 1,
): Promise<HTMLCanvasElement> => {
    // Tier 1: native browser rendering (best quality)
    try {
        return await nativeSvgToCanvas(svgText, width, height, scale);
    } catch {
        // Tainted — has <foreignObject>
    }

    // Tier 2: canvg (handles foreignObject)
    try {
        return await canvgSvgToCanvas(svgText, width, height, scale);
    } catch {
        // canvg failed (e.g. D2 with @font-face + foreignObject)
    }

    // Tier 3: strip foreignObject, then native canvas
    // (browser renders @font-face correctly, foreignObject text approximated)
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
