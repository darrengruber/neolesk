import { useEffect, useMemo, useRef, useState } from 'react';
import { browserRendererCatalog } from '../rendering/catalog';
import { createKrokiRemoteAdapter } from '../rendering/remote';
import {
    createRenderingModule,
    RenderingError,
    type RemoteRenderer,
    type RenderDiagnostic,
    type RenderProvenance,
} from '../rendering/rendering';
import { createSvgBlobUrl, getDimensions } from '../utils/svgExport';

const browserRendering = createRenderingModule({
    catalog: browserRendererCatalog,
    environment: 'browser',
    remoteRender: createKrokiRemoteAdapter(),
});

export interface DiagramRenderState {
    svgText: string | null;
    blobUrl: string | null;
    dimensions: { width: number; height: number } | null;
    loading: boolean;
    error: Error | null;
    consentRequired: boolean;
    diagnostics: RenderDiagnostic[];
    provenance: RenderProvenance | null;
}

const initialState: DiagramRenderState = {
    svgText: null,
    blobUrl: null,
    dimensions: null,
    loading: true,
    error: null,
    consentRequired: false,
    diagnostics: [],
    provenance: null,
};

export const useDiagramRender = ({
    language,
    source,
    remote,
    options = {},
}: {
    language: string;
    source: string;
    remote: RemoteRenderer | null;
    options?: Record<string, string>;
}): DiagramRenderState => {
    const [state, setState] = useState<DiagramRenderState>(initialState);
    const generationRef = useRef(0);
    const blobUrlRef = useRef<string | null>(null);
    const optionsKey = useMemo(() => JSON.stringify(options), [options]);

    useEffect(() => {
        const generation = ++generationRef.current;
        setState((current) => ({
            ...current,
            loading: true,
            error: null,
            consentRequired: false,
            diagnostics: [],
        }));

        browserRendering.render({
            language,
            source,
            format: 'svg',
            options: JSON.parse(optionsKey) as Record<string, string>,
            remote,
        }).then(async (result) => {
            if (generationRef.current !== generation) return;
            const blobUrl = createSvgBlobUrl(result.data);
            const dimensions = await getDimensions(result.data, blobUrl);
            if (generationRef.current !== generation) {
                URL.revokeObjectURL(blobUrl);
                return;
            }
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = blobUrl;
            setState({
                svgText: result.data,
                blobUrl,
                dimensions,
                loading: false,
                error: null,
                consentRequired: false,
                diagnostics: result.diagnostics,
                provenance: result.provenance,
            });
        }).catch((error: unknown) => {
            if (generationRef.current !== generation) return;
            const renderingError = error instanceof RenderingError ? error : null;
            setState((current) => ({
                ...current,
                loading: false,
                error: error instanceof Error ? error : new Error(String(error)),
                consentRequired: renderingError?.code === 'REMOTE_CONSENT_REQUIRED',
                diagnostics: renderingError?.diagnostics || [],
                provenance: null,
            }));
        });
    }, [language, optionsKey, remote?.id, remote?.label, remote?.url, source]);

    useEffect(() => () => {
        generationRef.current += 1;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    }, []);

    return state;
};

export const getBrowserRenderCapabilities = (language: string) => browserRendering.getCapabilities(language);
