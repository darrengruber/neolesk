import { useCallback, useEffect, useRef, useState } from 'react';
import { canRenderLocally, renderLocally } from '../engines';
import { createSvgBlobUrl, getDimensions } from '../utils/svgExport';

export interface SvgRenderError {
    message: string;
    status?: number;
    line?: number;
    column?: number;
}

export interface SvgRenderResult {
    svgText: string | null;
    blobUrl: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: SvgRenderError | null;
    local: boolean;
}

interface RenderFailure extends Error {
    retryable?: boolean;
    details?: SvgRenderError;
}

const parseErrorLocation = (message: string): Pick<SvgRenderError, 'line' | 'column'> => {
    const match = message.match(/line\s+(\d+)(?:[^\d]+column\s+(\d+))?/i)
        || message.match(/row\s+(\d+)(?:[^\d]+column\s+(\d+))?/i);

    return {
        line: match ? Number(match[1]) : undefined,
        column: match?.[2] ? Number(match[2]) : undefined,
    };
};

const createRenderFailure = (message: string, options?: { retryable?: boolean; status?: number }): RenderFailure => {
    const error = new Error(message) as RenderFailure;
    error.retryable = options?.retryable;
    error.details = {
        message,
        status: options?.status,
        ...parseErrorLocation(message),
    };
    return error;
};

const buildErrorMessage = (status: number | undefined, body: string): string => {
    const trimmed = body.trim();
    if (!trimmed) {
        return status ? `HTTP ${status}` : 'Failed to render diagram';
    }

    const singleLine = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)[0] || trimmed;
    return status ? `HTTP ${status}: ${singleLine}` : singleLine;
};

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
        error: null,
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

    useEffect(() => {
        setState((previous) => previous.local === local ? previous : { ...previous, local });
    }, [local]);

    useEffect(() => {
        if (!local) {
            return;
        }

        const generation = ++activeRef.current;

        setState((previous) => previous.svgText
            ? { ...previous, error: null, local: true }
            : { ...previous, loading: true, error: null, local: true });

        renderLocally(diagramType, source)
            .then(async (svgText) => {
                if (activeRef.current !== generation) {
                    return;
                }

                if (!svgText || !svgText.includes('<svg')) {
                    setState({
                        svgText: null,
                        blobUrl: null,
                        dimensions: null,
                        loading: false,
                        error: { message: 'Local renderer did not return valid SVG' },
                        local: true,
                    });
                    return;
                }

                revokeBlobUrl();
                const blobUrl = createSvgBlobUrl(svgText);
                blobUrlRef.current = blobUrl;
                const dimensions = await getDimensions(svgText, blobUrl);

                if (activeRef.current !== generation) {
                    return;
                }

                setState({ svgText, blobUrl, dimensions, loading: false, error: null, local: true });
            })
            .catch((error) => {
                if (activeRef.current !== generation) {
                    return;
                }

                const message = error instanceof Error ? error.message : 'Local renderer failed';
                setState({
                    svgText: null,
                    blobUrl: null,
                    dimensions: null,
                    loading: false,
                    error: { message, ...parseErrorLocation(message) },
                    local: true,
                });
            });
    }, [diagramType, source, local, revokeBlobUrl]);

    useEffect(() => {
        if (local) {
            return;
        }

        const generation = ++activeRef.current;
        const controller = new AbortController();
        let attempts = 0;
        let retryTimeout: number | null = null;

        const fetchSvg = async () => {
            try {
                const response = await fetch(svgUrl, { signal: controller.signal });
                const text = await response.text();

                if (!response.ok) {
                    throw createRenderFailure(buildErrorMessage(response.status, text), {
                        retryable: response.status >= 500,
                        status: response.status,
                    });
                }

                if (!text.includes('<svg')) {
                    throw createRenderFailure(buildErrorMessage(response.status, text), {
                        retryable: false,
                        status: response.status,
                    });
                }

                if (activeRef.current !== generation) {
                    return;
                }

                revokeBlobUrl();
                const blobUrl = createSvgBlobUrl(text);
                blobUrlRef.current = blobUrl;
                const dimensions = await getDimensions(text, blobUrl);

                if (activeRef.current !== generation) {
                    return;
                }

                setState({ svgText: text, blobUrl, dimensions, loading: false, error: null, local: false });
            } catch (error) {
                if (controller.signal.aborted) {
                    return;
                }

                const failure = error as RenderFailure;
                if ((failure.retryable ?? true) && attempts < 3) {
                    attempts += 1;
                    retryTimeout = window.setTimeout(fetchSvg, attempts * 300);
                    return;
                }

                setState({
                    svgText: null,
                    blobUrl: null,
                    dimensions: null,
                    loading: false,
                    error: failure.details || { message: failure.message || 'Failed to render diagram' },
                    local: false,
                });
            }
        };

        setState((previous) => ({ ...previous, loading: true, error: null, local: false }));
        fetchSvg();

        return () => {
            controller.abort();
            if (retryTimeout !== null) {
                window.clearTimeout(retryTimeout);
            }
        };
    }, [diagramType, svgUrl, local, revokeBlobUrl]);

    useEffect(() => () => revokeBlobUrl(), [revokeBlobUrl]);

    return state;
};
