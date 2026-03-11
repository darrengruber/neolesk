import { useCallback, useEffect, useRef, useState } from 'react';
import { canRenderLocally, renderLocally } from '../engines';
import { createSvgBlobUrl, getDimensions } from '../utils/svgExport';

interface SvgRenderResult {
    svgText: string | null;
    blobUrl: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: boolean;
    local: boolean;
}

export const useSvgRender = (
    diagramType: string,
    source: string,
    svgUrl: string,
): SvgRenderResult => {
    const local = canRenderLocally(diagramType);
    const [state, setState] = useState<SvgRenderResult>({
        svgText: null,
        blobUrl: null,
        dimensions: null,
        loading: true,
        error: false,
        local,
    });
    const blobUrlRef = useRef<string | null>(null);
    const activeRef = useRef(0);

    const revokeBlobUrl = useCallback(() => {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
    }, []);

    // Keep local flag in sync when diagramType changes
    useEffect(() => {
        setState(prev => prev.local === local ? prev : { ...prev, local });
    }, [local]);

    // Local rendering path
    useEffect(() => {
        if (!local) return;

        const generation = ++activeRef.current;

        // Only show loading state if we don't already have content to display.
        // This prevents the badge/image from flickering on every keystroke.
        setState(prev => prev.svgText
            ? { ...prev, error: false, local: true }
            : { ...prev, loading: true, error: false, local: true },
        );

        renderLocally(diagramType, source)
            .then(async (svgText) => {
                if (activeRef.current !== generation) return;

                if (!svgText || !svgText.includes('<svg')) {
                    setState({ svgText: null, blobUrl: null, dimensions: null, loading: false, error: true, local: true });
                    return;
                }

                revokeBlobUrl();
                const blobUrl = createSvgBlobUrl(svgText);
                blobUrlRef.current = blobUrl;
                const dimensions = await getDimensions(svgText, blobUrl);

                if (activeRef.current !== generation) return;
                setState({ svgText, blobUrl, dimensions, loading: false, error: false, local: true });
            })
            .catch(() => {
                if (activeRef.current !== generation) return;
                setState({ svgText: null, blobUrl: null, dimensions: null, loading: false, error: true, local: true });
            });
    }, [diagramType, source, local, revokeBlobUrl]);

    // Remote fetch path
    useEffect(() => {
        if (local) return;

        const generation = ++activeRef.current;
        const controller = new AbortController();
        let attempts = 0;
        let retryTimeout: number | null = null;

        const fetchSvg = async () => {
            try {
                const response = await fetch(svgUrl, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const text = await response.text();
                if (!text.includes('<svg')) throw new Error('Invalid SVG response');
                if (activeRef.current !== generation) return;

                revokeBlobUrl();
                const blobUrl = createSvgBlobUrl(text);
                blobUrlRef.current = blobUrl;
                const dimensions = await getDimensions(text, blobUrl);

                if (activeRef.current !== generation) return;
                setState({ svgText: text, blobUrl, dimensions, loading: false, error: false, local: false });
            } catch (err) {
                if (controller.signal.aborted) return;
                if (attempts < 3) {
                    attempts += 1;
                    retryTimeout = window.setTimeout(fetchSvg, attempts * 300);
                    return;
                }
                setState({ svgText: null, blobUrl: null, dimensions: null, loading: false, error: true, local: false });
            }
        };

        setState(prev => ({ ...prev, loading: true, error: false, local: false }));
        fetchSvg();

        return () => {
            controller.abort();
            if (retryTimeout !== null) window.clearTimeout(retryTimeout);
        };
    }, [diagramType, svgUrl, local, revokeBlobUrl]);

    useEffect(() => {
        return () => revokeBlobUrl();
    }, [revokeBlobUrl]);

    return state;
};
