import { useCallback, useEffect, useRef, useState } from 'react';

interface SvgFetchResult {
    svgUrl: string;
    svgText: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: boolean;
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

export const useSvgFetch = (svgUrl: string): SvgFetchResult => {
    const [state, setState] = useState<SvgFetchResult>({
        svgUrl,
        svgText: null,
        dimensions: null,
        loading: true,
        error: false,
    });
    const currentUrlRef = useRef<string>(svgUrl);

    useEffect(() => {
        currentUrlRef.current = svgUrl;
        const controller = new AbortController();
        let attempts = 0;
        let retryTimeout: ReturnType<typeof setTimeout> | null = null;

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

                const dimensions = parseSvgDimensions(text) || { width: 800, height: 600 };
                setState({ svgUrl, svgText: text, dimensions, loading: false, error: false });
            } catch (err) {
                if (controller.signal.aborted) return;

                if (attempts < 3) {
                    attempts += 1;
                    retryTimeout = setTimeout(fetchSvg, attempts * 300);
                    return;
                }

                setState({ svgUrl, svgText: null, dimensions: null, loading: false, error: true });
            }
        };

        setState((prev) => ({ ...prev, svgUrl, loading: true, error: false }));
        fetchSvg();

        return () => {
            controller.abort();
            if (retryTimeout !== null) {
                clearTimeout(retryTimeout);
            }
        };
    }, [svgUrl]);

    return state;
};
