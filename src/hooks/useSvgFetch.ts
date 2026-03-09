import { useCallback, useEffect, useRef, useState } from 'react';
import { createSvgBlobUrl, getDimensions } from '../utils/svgExport';

interface SvgFetchResult {
    svgText: string | null;
    blobUrl: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: boolean;
}

export const useSvgFetch = (svgUrl: string): SvgFetchResult => {
    const [state, setState] = useState<SvgFetchResult>({
        svgText: null,
        blobUrl: null,
        dimensions: null,
        loading: true,
        error: false,
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

                setState({ svgText: text, blobUrl, dimensions, loading: false, error: false });
            } catch (err) {
                if (controller.signal.aborted) {
                    return;
                }

                if (attempts < 3) {
                    attempts += 1;
                    retryTimeout = window.setTimeout(fetchSvg, attempts * 300);
                    return;
                }

                setState({ svgText: null, blobUrl: null, dimensions: null, loading: false, error: true });
            }
        };

        setState((prev) => ({ ...prev, loading: true, error: false }));
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
