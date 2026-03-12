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

const parseSvgDimensions = (svgText: string): { width: number; height: number } => {
    const wm = svgText.match(/<svg[^>]*\bwidth="([^"]+)"/);
    const hm = svgText.match(/<svg[^>]*\bheight="([^"]+)"/);
    if (wm && hm) {
        const w = parseFloat(wm[1]);
        const h = parseFloat(hm[1]);
        if (w > 0 && h > 0) return { width: w, height: h };
    }
    const vb = svgText.match(/<svg[^>]*\bviewBox="([^"]+)"/);
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

/** Render SVG text to canvas. */
const renderToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale: number,
): Promise<HTMLCanvasElement> => {
    // Use data URI instead of blob URL — data URIs are same-origin and
    // avoid canvas tainting even with <foreignObject> content.
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
    const img = await loadImage(dataUri);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    // Taint check
    canvas.toDataURL();
    return canvas;
};

/**
 * Render SVG to canvas with three-tier fallback:
 *   1. Direct data URI render (best — preserves foreignObject perfectly if browser supports it)
 *   2. Inline computed styles on foreignObject children, then data URI (fixes missing CSS)
 *   3. Strip foreignObject → SVG <text> approximation (last resort, handles all cases)
 */
const svgToCanvas = async (
    svgText: string,
    width: number,
    height: number,
    scale: number,
): Promise<HTMLCanvasElement> => {
    // Tier 1: direct render
    try {
        return await renderToCanvas(svgText, width, height, scale);
    } catch {
        // Tainted or failed
    }

    // Tier 2: inline foreignObject styles so they survive data URI serialization
    try {
        const inlined = inlineForeignObjectStyles(svgText);
        return await renderToCanvas(inlined, width, height, scale);
    } catch {
        // Still tainted
    }

    // Tier 3: strip foreignObject entirely, replace with <text> approximations
    const stripped = stripForeignObjects(svgText);
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

const exportWeb = async ({ svgText, diagramType, format }: ExportOptions): Promise<void> => {
    const filename = `${diagramType}-diagram.${format}`;

    if (format === 'svg') {
        downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), filename);
        return;
    }

    const dims = parseSvgDimensions(svgText);

    if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        const scale = printScale(dims.width, dims.height);
        const canvas = await svgToCanvas(svgText, dims.width, dims.height, scale);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const orientation = dims.width > dims.height ? 'landscape' : 'portrait';
        const pdf = new jsPDF({ orientation, unit: 'px', format: [dims.width, dims.height] });
        pdf.addImage(dataUrl, 'JPEG', 0, 0, dims.width, dims.height);
        downloadBlob(pdf.output('blob'), filename);
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
