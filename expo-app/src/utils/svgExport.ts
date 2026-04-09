import { Platform } from 'react-native';
import type { RefObject } from 'react';

export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'pdf';

export interface ExportOptions {
    svgText: string;
    diagramType: string;
    format: ExportFormat;
    /** Ref to the View wrapping the rendered diagram (for native view-shot capture). */
    captureViewRef?: RefObject<any>;
}

// ─── Shared helpers ─────────────────────────────────────────────────────

/** Convert a CSS length value (with optional unit) to pixels. */
const toPx = (value: string): number => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return 0;
    const unit = value.replace(/^[\d.]+/, '').trim().toLowerCase();
    switch (unit) {
        case 'pt': return num * (96 / 72);   // 1pt = 1.333px
        case 'pc': return num * 16;          // 1pc = 16px
        case 'in': return num * 96;          // 1in = 96px
        case 'cm': return num * (96 / 2.54); // 1cm ≈ 37.8px
        case 'mm': return num * (96 / 25.4); // 1mm ≈ 3.78px
        case 'em': return num * 16;          // assume 16px base
        default: return num;                 // px or unitless
    }
};

const parseSvgDimensions = (svgText: string): { width: number; height: number } => {
    const wm = svgText.match(/<svg[^>]*\bwidth=['"]([^'"]+)['"]/);
    const hm = svgText.match(/<svg[^>]*\bheight=['"]([^'"]+)['"]/);
    if (wm && hm) {
        const w = toPx(wm[1]);
        const h = toPx(hm[1]);
        if (w > 0 && h > 0) return { width: w, height: h };
    }
    const vb = svgText.match(/<svg[^>]*\bviewBox=['"]([^'"]+)['"]/);
    if (vb) {
        const parts = vb[1].split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0)
            return { width: parts[2], height: parts[3] };
    }
    return { width: 800, height: 600 };
};

const printScale = (width: number, height: number): number => {
    const targetLongEdge = 2400;
    const maxScale = 8;
    const longEdge = Math.max(width, height);
    return Math.min(maxScale, Math.max(1, targetLongEdge / longEdge));
};

// ─── Web export (canvas-based, fully local) ─────────────────────────────

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load SVG image'));
        img.src = src;
    });

/**
 * Strip XML processing instructions (e.g. <?plantuml ...?>) that prevent
 * data URI loading, and ensure the SVG has proper xmlns attributes.
 */
const sanitizeSvg = (svgText: string): string => {
    // Remove processing instructions like <?xml ...?>, <?plantuml ...?>
    let cleaned = svgText.replace(/<\?[^?]*\?>/g, '');
    // Remove <!DOCTYPE ...> declarations (external DTD refs fail in data URIs)
    cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '').trim();

    // Ensure xmlns is present on the root <svg> element
    if (cleaned.includes('<svg') && !cleaned.match(/<svg[^>]*xmlns\s*=/)) {
        cleaned = cleaned.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Strip percentage-based width/height (they don't work in data URI <img>)
    // The renderToCanvas function will set explicit pixel dimensions.
    cleaned = cleaned.replace(/(<svg[^>]*)\swidth=['"][^'"]*%['"]/i, '$1');
    cleaned = cleaned.replace(/(<svg[^>]*)\sheight=['"][^'"]*%['"]/i, '$1');

    // Remove max-width/max-height from SVG root style (conflicts with explicit sizing)
    cleaned = cleaned.replace(
        /(<svg[^>]*style=['"])([^'"]*)(max-width:\s*[^;'"]+;?\s*)([^'"]*['"])/i,
        (_, before, pre, _mw, after) => before + pre + after
    );

    return cleaned;
};

/** CSS properties that are valid SVG presentation attributes. */
const SVG_PRESENTATION_ATTRS: Record<string, string> = {
    'fill': 'fill',
    'fill-opacity': 'fill-opacity',
    'fill-rule': 'fill-rule',
    'stroke': 'stroke',
    'stroke-width': 'stroke-width',
    'stroke-opacity': 'stroke-opacity',
    'stroke-linecap': 'stroke-linecap',
    'stroke-linejoin': 'stroke-linejoin',
    'stroke-miterlimit': 'stroke-miterlimit',
    'stroke-dasharray': 'stroke-dasharray',
    'stroke-dashoffset': 'stroke-dashoffset',
    'opacity': 'opacity',
    'font-family': 'font-family',
    'font-size': 'font-size',
    'font-weight': 'font-weight',
    'font-style': 'font-style',
    'font-variant': 'font-variant',
    'font-stretch': 'font-stretch',
    'text-anchor': 'text-anchor',
    'text-decoration': 'text-decoration',
    'dominant-baseline': 'dominant-baseline',
    'alignment-baseline': 'alignment-baseline',
    'letter-spacing': 'letter-spacing',
    'word-spacing': 'word-spacing',
    'color': 'color',
    'display': 'display',
    'visibility': 'visibility',
    'overflow': 'overflow',
    'marker': 'marker',
    'marker-start': 'marker-start',
    'marker-mid': 'marker-mid',
    'marker-end': 'marker-end',
    'clip-rule': 'clip-rule',
    'text-align': 'text-align',
};

/**
 * Inline ALL CSS <style> rules in the SVG as attributes/inline styles on
 * matching elements. This makes the SVG self-contained for data URI rendering
 * where <style> blocks are not applied.
 *
 * Uses an off-screen SVG element (not div.innerHTML) to preserve SVG
 * namespaces and avoid HTML parser corruption of SVG markup.
 *
 * Works for both regular SVG elements and foreignObject children.
 */
const inlineAllStyles = (svgText: string): string => {
    // Quick check: does the SVG have any <style> elements?
    if (!svgText.includes('<style')) return svgText;

    // Parse as XML to preserve SVG namespaces (xlink:href, etc.)
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');

    // If XML parsing fails, fall back to HTML parser via hidden container
    if (parseError) {
        return inlineAllStylesFallback(svgText);
    }

    const svgEl = doc.documentElement;
    if (svgEl.tagName !== 'svg') return svgText;

    // We need to insert into the live document to use querySelectorAll with CSS selectors
    // Wrap in an offscreen container
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    document.body.appendChild(container);

    // Import the SVG node into the live document
    const importedSvg = document.importNode(svgEl, true) as SVGSVGElement;
    container.appendChild(importedSvg);

    try {
        const styleEls = Array.from(importedSvg.querySelectorAll('style'));
        if (styleEls.length === 0) return svgText;

        // Parse CSS rules using temporary stylesheets
        const rules: Array<{ selector: string; props: Map<string, string> }> = [];
        for (const styleEl of styleEls) {
            const cssText = styleEl.textContent || '';
            const tmpStyle = document.createElement('style');
            tmpStyle.textContent = cssText;
            document.head.appendChild(tmpStyle);
            try {
                const sheet = tmpStyle.sheet;
                if (sheet) {
                    for (let i = 0; i < sheet.cssRules.length; i++) {
                        const rule = sheet.cssRules[i];
                        if (rule instanceof CSSStyleRule) {
                            const props = new Map<string, string>();
                            for (let j = 0; j < rule.style.length; j++) {
                                const prop = rule.style[j];
                                props.set(prop, rule.style.getPropertyValue(prop));
                            }
                            if (props.size > 0) {
                                rules.push({ selector: rule.selectorText, props });
                            }
                        }
                    }
                }
            } finally {
                document.head.removeChild(tmpStyle);
            }
        }

        // Apply each rule to matching elements
        for (const { selector, props } of rules) {
            if (selector.startsWith('@') || selector === ':root') continue;

            let targets: Element[];
            try {
                targets = Array.from(importedSvg.querySelectorAll(selector));
            } catch {
                continue;
            }

            for (const el of targets) {
                const isSvgElement = el.namespaceURI === 'http://www.w3.org/2000/svg';
                const existingStyle = el.getAttribute('style') || '';
                const existingProps = new Set(
                    existingStyle.split(';').map(s => s.split(':')[0].trim()).filter(Boolean)
                );

                const newStyleParts: string[] = existingStyle ? [existingStyle] : [];

                for (const [prop, val] of props) {
                    if (existingProps.has(prop)) continue;

                    if (isSvgElement && SVG_PRESENTATION_ATTRS[prop]) {
                        if (!el.hasAttribute(SVG_PRESENTATION_ATTRS[prop])) {
                            el.setAttribute(SVG_PRESENTATION_ATTRS[prop], val);
                        }
                    } else {
                        newStyleParts.push(`${prop}:${val}`);
                    }
                }

                const finalStyle = newStyleParts.join(';').replace(/;+/g, ';').replace(/^;|;$/g, '');
                if (finalStyle) {
                    el.setAttribute('style', finalStyle);
                }
            }
        }

        // Remove <style> elements (keep @font-face with embedded data URIs)
        for (const styleEl of styleEls) {
            const cssText = styleEl.textContent || '';
            const fontFaceRules: string[] = [];
            const fontFaceRegex = /@font-face\s*\{[^}]*url\s*\(\s*data:[^)]+\)[^}]*\}/g;
            let match;
            while ((match = fontFaceRegex.exec(cssText)) !== null) {
                fontFaceRules.push(match[0]);
            }

            if (fontFaceRules.length > 0) {
                styleEl.textContent = fontFaceRules.join('\n');
            } else {
                styleEl.remove();
            }
        }

        return new XMLSerializer().serializeToString(importedSvg);
    } finally {
        document.body.removeChild(container);
    }
};

/** Fallback for SVGs that fail XML parsing (e.g., with HTML entities). */
const inlineAllStylesFallback = (svgText: string): string => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;

        const styleEls = Array.from(svgEl.querySelectorAll('style'));
        if (styleEls.length === 0) return svgText;

        const rules: Array<{ selector: string; props: Map<string, string> }> = [];
        for (const styleEl of styleEls) {
            const cssText = styleEl.textContent || '';
            const tmpStyle = document.createElement('style');
            tmpStyle.textContent = cssText;
            document.head.appendChild(tmpStyle);
            try {
                const sheet = tmpStyle.sheet;
                if (sheet) {
                    for (let i = 0; i < sheet.cssRules.length; i++) {
                        const rule = sheet.cssRules[i];
                        if (rule instanceof CSSStyleRule) {
                            const props = new Map<string, string>();
                            for (let j = 0; j < rule.style.length; j++) {
                                const prop = rule.style[j];
                                props.set(prop, rule.style.getPropertyValue(prop));
                            }
                            if (props.size > 0) {
                                rules.push({ selector: rule.selectorText, props });
                            }
                        }
                    }
                }
            } finally {
                document.head.removeChild(tmpStyle);
            }
        }

        for (const { selector, props } of rules) {
            if (selector.startsWith('@') || selector === ':root') continue;
            let targets: Element[];
            try {
                targets = Array.from(svgEl.querySelectorAll(selector));
            } catch {
                continue;
            }
            for (const el of targets) {
                const isSvgElement = el.namespaceURI === 'http://www.w3.org/2000/svg';
                const existingStyle = el.getAttribute('style') || '';
                const existingProps = new Set(
                    existingStyle.split(';').map(s => s.split(':')[0].trim()).filter(Boolean)
                );
                const newStyleParts: string[] = existingStyle ? [existingStyle] : [];
                for (const [prop, val] of props) {
                    if (existingProps.has(prop)) continue;
                    if (isSvgElement && SVG_PRESENTATION_ATTRS[prop]) {
                        if (!el.hasAttribute(SVG_PRESENTATION_ATTRS[prop])) {
                            el.setAttribute(SVG_PRESENTATION_ATTRS[prop], val);
                        }
                    } else {
                        newStyleParts.push(`${prop}:${val}`);
                    }
                }
                const finalStyle = newStyleParts.join(';').replace(/;+/g, ';').replace(/^;|;$/g, '');
                if (finalStyle) el.setAttribute('style', finalStyle);
            }
        }

        for (const styleEl of styleEls) {
            const cssText = styleEl.textContent || '';
            const fontFaceRules: string[] = [];
            const fontFaceRegex = /@font-face\s*\{[^}]*url\s*\(\s*data:[^)]+\)[^}]*\}/g;
            let match;
            while ((match = fontFaceRegex.exec(cssText)) !== null) {
                fontFaceRules.push(match[0]);
            }
            if (fontFaceRules.length > 0) {
                styleEl.textContent = fontFaceRules.join('\n');
            } else {
                styleEl.remove();
            }
        }

        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
};

/**
 * Inline all computed styles on foreignObject children so that
 * the SVG is self-contained when rendered as a data URI <img>.
 */
const inlineForeignObjectStyles = (svgText: string): string => {
    if (!svgText.includes('<foreignObject')) return svgText;

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;

        // Walk every element inside every foreignObject and inline computed styles
        for (const fo of Array.from(svgEl.querySelectorAll('foreignObject'))) {
            for (const el of Array.from(fo.querySelectorAll('*'))) {
                const computed = window.getComputedStyle(el);
                const important = [
                    'color', 'background-color', 'font-family', 'font-size',
                    'font-weight', 'font-style', 'text-align', 'line-height',
                    'padding', 'margin', 'border', 'display', 'white-space',
                    'overflow', 'text-decoration', 'letter-spacing', 'word-spacing',
                ];
                const inlined: string[] = [];
                for (const prop of important) {
                    const val = computed.getPropertyValue(prop);
                    if (val) inlined.push(`${prop}:${val}`);
                }
                (el as HTMLElement).setAttribute('style', inlined.join(';'));
            }
        }

        // Also inline any <style> rules as attributes on their targets
        // to ensure fonts/colors survive the data URI serialization
        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
};

/**
 * Strip <foreignObject> elements, replacing with styled <text> elements.
 * Last-resort fallback when even inlined foreignObjects taint the canvas.
 */
const stripForeignObjects = (svgText: string): string => {
    if (!svgText.includes('<foreignObject')) return svgText;

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;

        for (const fo of Array.from(svgEl.querySelectorAll('foreignObject'))) {
            const text = (fo.textContent || '').trim();
            if (!text) { fo.remove(); continue; }

            let styledEl: Element = fo;
            for (const el of Array.from(fo.querySelectorAll('span, p, div'))) {
                if ((el.textContent || '').trim().length > 0) styledEl = el;
            }

            const computed = window.getComputedStyle(styledEl);
            const foWidth = parseFloat(fo.getAttribute('width') || '0');
            const foHeight = parseFloat(fo.getAttribute('height') || '0');
            const foX = parseFloat(fo.getAttribute('x') || '0');
            const foY = parseFloat(fo.getAttribute('y') || '0');

            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('x', String(foX + foWidth / 2));
            textEl.setAttribute('y', String(foY + foHeight / 2));
            textEl.setAttribute('text-anchor', 'middle');
            textEl.setAttribute('dominant-baseline', 'central');
            textEl.setAttribute('font-family', computed.fontFamily || 'sans-serif');
            textEl.setAttribute('font-size', computed.fontSize || '14px');
            if (computed.fontWeight && computed.fontWeight !== '400' && computed.fontWeight !== 'normal') {
                textEl.setAttribute('font-weight', computed.fontWeight);
            }
            textEl.setAttribute('fill', computed.color || '#000');
            textEl.textContent = text;
            fo.parentNode?.replaceChild(textEl, fo);
        }

        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
};

/** Render SVG text to canvas. Uses the image's natural pixel dimensions for accuracy. */
const renderToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale: number,
): Promise<HTMLCanvasElement> => {
    // Ensure the SVG has explicit width/height attributes so the <img>
    // renders at the exact dimensions we want.
    let preparedSvg = svgText
        .replace(/(<svg[^>]*?)\swidth=['"][^'"]*['"]/i, '$1')
        .replace(/(<svg[^>]*?)\sheight=['"][^'"]*['"]/i, '$1')
        .replace(/(<svg)(\s)/, `$1 width="${width}" height="${height}"$2`);

    // Use data URI instead of blob URL — data URIs are same-origin and
    // avoid canvas tainting even with <foreignObject> content.
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(preparedSvg)));
    const img = await loadImage(dataUri);

    const drawW = width;
    const drawH = height;

    const canvas = document.createElement('canvas');
    canvas.width = drawW * scale;
    canvas.height = drawH * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, drawW, drawH);
    // Taint check
    canvas.toDataURL();
    return canvas;
};

/**
 * Render SVG to canvas.
 *
 * foreignObject detection:
 *   Data URI <img> rendering silently drops foreignObject content (no taint
 *   error — the text is just invisible). So we detect foreignObject upfront
 *   and convert those labels to SVG <text> before rendering.
 *
 * For SVGs without foreignObject, direct data URI render is used (fastest,
 * pixel-perfect). Falls back through style-inlining if taint does occur.
 */
const svgToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale: number,
): Promise<HTMLCanvasElement> => {
    // Pre-process ALL SVGs: strip processing instructions and DOCTYPE
    let processed = sanitizeSvg(svgText);

    const hasFO = processed.includes('<foreignObject');

    if (!hasFO) {
        // Fast path: no foreignObject, direct render is safe
        return renderToCanvas(processed, width, height, scale);
    }

    // foreignObject present — convert to <text> approximations first,
    // then render. This preserves text labels that would otherwise be
    // silently dropped by the data URI <img> pipeline.
    try {
        // Try inlining styles first (preserves layout better if it works)
        const inlined = inlineForeignObjectStyles(processed);
        return await renderToCanvas(inlined, width, height, scale);
    } catch {
        // Inlined styles still tainted — strip foreignObject entirely
    }

    const stripped = stripForeignObjects(processed);
    return renderToCanvas(stripped, width, height, scale);
};

const canvasToBlob = (
    canvas: HTMLCanvasElement,
    mimeType: string,
    quality?: number,
): Promise<Blob> =>
    new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
            mimeType,
            quality,
        );
    });

const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

/** Engines whose SVGs use <foreignObject> — svg2pdf.js can't handle these. */
const RASTER_PDF_ENGINES = new Set(['mermaid', 'd2', 'nomnoml']);

/**
 * Export SVG to PDF. Uses svg2pdf.js for vector output when possible,
 * falls back to raster (canvas → JPEG → jsPDF) for engines with foreignObject.
 */
const exportPdfWeb = async (
    svgText: string,
    dims: { width: number; height: number },
    diagramType: string,
): Promise<Blob> => {
    const { jsPDF } = await import('jspdf');

    // Vector path: svg2pdf.js (crisp text/shapes at any zoom)
    if (!RASTER_PDF_ENGINES.has(diagramType)) {
        try {
            const { svg2pdf } = await import('svg2pdf.js');
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden';
            container.innerHTML = svgText;
            document.body.appendChild(container);
            const svgEl = container.querySelector('svg')!;

            try {
                const orientation = dims.width > dims.height ? 'landscape' : 'portrait';
                const pdf = new jsPDF({ orientation, unit: 'px', format: [dims.width, dims.height] });
                await svg2pdf(svgEl, pdf, { x: 0, y: 0, width: dims.width, height: dims.height });
                return pdf.output('blob');
            } finally {
                document.body.removeChild(container);
            }
        } catch {
            // svg2pdf choked — fall through to raster
        }
    }

    // Raster path: canvas → JPEG → jsPDF (handles foreignObject, always works)
    const scale = printScale(dims.width, dims.height);
    const canvas = await svgToCanvas(svgText, dims.width, dims.height, scale);
    const pdfW = canvas.width / scale;
    const pdfH = canvas.height / scale;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const orientation = pdfW > pdfH ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [pdfW, pdfH] });
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, pdfH);
    return pdf.output('blob');
};

const exportWeb = async ({ svgText, diagramType, format }: ExportOptions): Promise<void> => {
    const filename = `${diagramType}-diagram.${format}`;

    if (format === 'svg') {
        downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), filename);
        return;
    }

    const dims = parseSvgDimensions(svgText);

    if (format === 'pdf') {
        const blob = await exportPdfWeb(svgText, dims, diagramType);
        downloadBlob(blob, filename);
        return;
    }

    // PNG or JPEG
    const scale = format === 'png' ? printScale(dims.width, dims.height) : 1;
    const canvas = await svgToCanvas(svgText, dims.width, dims.height, scale);
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpeg' ? 0.92 : undefined;
    const blob = await canvasToBlob(canvas, mimeType, quality);
    downloadBlob(blob, filename);
};

// ─── Native export (view-shot + expo-print, fully local) ────────────────

const exportNative = async ({ svgText, diagramType, format, captureViewRef }: ExportOptions): Promise<void> => {
    const FS = await import('expo-file-system/legacy');
    const Sharing = await import('expo-sharing');

    const filename = `${diagramType}-diagram.${format}`;
    const fileUri = `${FS.cacheDirectory}${filename}`;

    if (format === 'svg') {
        await FS.writeAsStringAsync(fileUri, svgText, {
            encoding: FS.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri, {
                mimeType: 'image/svg+xml',
                dialogTitle: `Export as SVG`,
            });
        }
        return;
    }

    if (format === 'pdf') {
        const Print = await import('expo-print');
        const dims = parseSvgDimensions(svgText);
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${dims.width}px;height:${dims.height}px}svg{max-width:100%;height:auto}</style></head><body>${svgText}</body></html>`;
        const { uri } = await Print.printToFileAsync({ html, width: dims.width, height: dims.height });
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
                mimeType: 'application/pdf',
                dialogTitle: `Export as PDF`,
            });
        }
        return;
    }

    // PNG/JPEG: capture the rendered view using react-native-view-shot
    if (!captureViewRef?.current) {
        throw new Error('View ref not available for capture');
    }

    const { captureRef } = await import('react-native-view-shot');
    const capturedUri = await captureRef(captureViewRef, {
        format: format === 'jpeg' ? 'jpg' : 'png',
        quality: format === 'jpeg' ? 0.92 : 1,
        result: 'tmpfile',
    });

    // Copy to our cache with the right filename
    await FS.copyAsync({ from: capturedUri, to: fileUri });

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
            mimeType,
            dialogTitle: `Export as ${format.toUpperCase()}`,
        });
    }
};

// ─── Public API ─────────────────────────────────────────────────────────

export const exportDiagram = async (options: ExportOptions): Promise<void> => {
    if (Platform.OS === 'web') {
        return exportWeb(options);
    }
    return exportNative(options);
};
