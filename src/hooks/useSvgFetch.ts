import { useCallback, useEffect, useRef, useState } from 'react';
import { createSvgBlobUrl, getDimensions } from '../utils/svgExport';
import { parseKrokiError } from '../utils/errorParser';
import type { KrokiError } from '../types';

export interface SvgFetchResult {
    svgText: string | null;
    blobUrl: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: KrokiError | null;
}

export const useSvgFetch = (svgUrl: string): SvgFetchResult => {
    const [state, setState] = useState<SvgFetchResult>({
        svgText: null,
        blobUrl: null,
        dimensions: null,
        loading: true,
        error: null,
    });
    const blobUrlRef = useRef<string | null>(null);
    const currentUrlRef = useRef<string>(svgUrl);

    const revokeBlobUrl = useCallback(() => {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
    }, []);

    useEffect(() => {
        currentUrlRef.current = svgUrl;
        const controller = new AbortController();
        let attempts = 0;
        let retryTimeout: number | null = null;

        const fetchSvg = async () => {
            try {
                const response = await fetch(svgUrl, { signal: controller.signal });
                if (!response.ok) {
                    if (response.status === 400) {
                        const body = await response.text();
                        if (currentUrlRef.current !== svgUrl) return;
                        const krokiError = parseKrokiError(body);
                        setState({ svgText: null, blobUrl: null, dimensions: null, loading: false, error: krokiError });
                        return;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                const text = await response.text();
                if (!text.includes('<svg')) {
                    throw new Error('Invalid SVG response');
                }

                if (currentUrlRef.current !== svgUrl) return;

                revokeBlobUrl();
                const blobUrl = createSvgBlobUrl(text);
                blobUrlRef.current = blobUrl;

                // Get dimensions from SVG attributes first, fallback to image load
                const dimensions = await getDimensions(text, blobUrl);

                if (currentUrlRef.current !== svgUrl) return;

                setState({ svgText: text, blobUrl, dimensions, loading: false, error: null });
            } catch (err) {
                if (controller.signal.aborted) {
                    return;
                }

                if (attempts < 3) {
                    attempts += 1;
                    retryTimeout = window.setTimeout(fetchSvg, attempts * 300);
                    return;
                }

                setState({
                    svgText: null,
                    blobUrl: null,
                    dimensions: null,
                    loading: false,
                    error: { message: 'Failed to load diagram', lineNumber: null },
                });
            }
        };

        setState((prev) => ({ ...prev, loading: true, error: null }));
        fetchSvg();

        return () => {
            controller.abort();
            if (retryTimeout !== null) {
                window.clearTimeout(retryTimeout);
            }
        };
    }, [svgUrl, revokeBlobUrl]);

    // Revoke blob URL only on unmount
    useEffect(() => {
        return () => revokeBlobUrl();
    }, [revokeBlobUrl]);

    return state;
};
