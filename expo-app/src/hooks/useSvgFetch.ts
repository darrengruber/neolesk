import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hasLocalEngine, renderLocal } from '../engines';
import { cachedSvgFetch } from '../utils/svgCache';

interface SvgFetchResult {
    svgUrl: string;
    svgText: string | null;
    blobUrl: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: boolean;
    local: boolean;
}

interface UseSvgFetchOptions {
    svgUrl: string;
    diagramType: string;
    diagramText: string;
}

/** Parse width/height from SVG text using regex (no DOMParser in RN). */
const parseSvgDimensions = (svgText: string): { width: number; height: number } | null => {
    const widthMatch = svgText.match(/<svg[^>]*\bwidth="([^"]+)"/);
    const heightMatch = svgText.match(/<svg[^>]*\bheight="([^"]+)"/);

    if (widthMatch && heightMatch) {
        const w = parseFloat(widthMatch[1]);
        const h = parseFloat(heightMatch[1]);
        if (w > 0 && h > 0) return { width: w, height: h };
    }

    const viewBoxMatch = svgText.match(/<svg[^>]*\bviewBox="([^"]+)"/);
    if (viewBoxMatch) {
        const parts = viewBoxMatch[1].split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] };
        }
    }

    return null;
};

const createSvgBlobUrl = (svgText: string): string | null => {
    if (Platform.OS !== 'web' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
        return null;
    }
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    return URL.createObjectURL(blob);
};

export const useSvgFetch = ({ svgUrl, diagramType, diagramText }: UseSvgFetchOptions): SvgFetchResult => {
    const [state, setState] = useState<SvgFetchResult>({
        svgUrl,
        svgText: null,
        blobUrl: null,
        dimensions: null,
        loading: true,
        error: false,
        local: false,
    });
    const blobUrlRef = useRef<string | null>(null);

    const revokeBlobUrl = useCallback(() => {
        if (blobUrlRef.current && typeof URL !== 'undefined') {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
    }, []);

    const applySvg = useCallback((svgText: string, url: string, local: boolean) => {
        revokeBlobUrl();
        const blobUrl = createSvgBlobUrl(svgText);
        blobUrlRef.current = blobUrl;
        const dimensions = parseSvgDimensions(svgText) || { width: 800, height: 600 };
        setState({ svgUrl: url, svgText, blobUrl, dimensions, loading: false, error: false, local });
    }, [revokeBlobUrl]);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;
        let retryTimeout: ReturnType<typeof setTimeout> | null = null;

        setState((prev) => ({ ...prev, svgUrl, loading: true, error: false }));

        const fetchRemote = async () => {
            let attempts = 0;
            const doFetch = async (): Promise<void> => {
                try {
                    const response = await cachedSvgFetch(svgUrl, null, controller.signal);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                    const text = await response.text();
                    if (!text.includes('<svg')) throw new Error('Invalid SVG response');
                    if (cancelled) return;

                    applySvg(text, svgUrl, false);
                } catch (err) {
                    if (cancelled || controller.signal.aborted) return;

                    if (attempts < 3) {
                        attempts += 1;
                        await new Promise<void>((resolve) => {
                            retryTimeout = setTimeout(resolve, attempts * 300);
                        });
                        if (!cancelled) return doFetch();
                    }

                    setState({ svgUrl, svgText: null, blobUrl: null, dimensions: null, loading: false, error: true, local: false });
                }
            };
            return doFetch();
        };

        const run = async () => {
            // Try local engine first
            if (hasLocalEngine(diagramType)) {
                try {
                    const svgText = await renderLocal(diagramType, diagramText);
                    if (cancelled) return;
                    applySvg(svgText, svgUrl, true);
                    return;
                } catch {
                    // Local failed, fall through to remote
                    if (cancelled) return;
                }
            }

            // Remote fetch
            await fetchRemote();
        };

        run();

        return () => {
            cancelled = true;
            controller.abort();
            if (retryTimeout !== null) clearTimeout(retryTimeout);
        };
    }, [svgUrl, diagramType, diagramText, applySvg]);

    useEffect(() => {
        return () => revokeBlobUrl();
    }, [revokeBlobUrl]);

    return state;
};
