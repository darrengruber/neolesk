export type RenderEnvironment = 'browser' | 'worker';

export interface RenderRequest {
    language: string;
    source: string;
    format: string;
    rendererId?: string;
    options?: Record<string, string>;
    remote: RemoteRenderer | null;
}

export interface RendererInput {
    language: string;
    source: string;
    format: string;
    options: Record<string, string>;
}

export interface RendererAdapter {
    id: string;
    label: string;
    environments: RenderEnvironment[];
    languages: string[];
    formats: string[];
    /** Use a consented server for the first render while a large local runtime downloads. */
    remoteWhileLoading?: boolean;
    /** Optional warm-up hook. Capability checks never invoke it. */
    load?: () => Promise<void>;
    render: (input: RendererInput) => Promise<string>;
}

export interface RemoteRenderer {
    id: string;
    label: string;
    url: string;
}

export interface RemoteRenderInput extends RendererInput {
    serverUrl: string;
}

export interface RenderDiagnostic {
    kind: 'fallback' | 'render';
    message: string;
    rendererId: string;
    line?: number;
    column?: number;
}

export type RenderProvenance =
    | {
        kind: 'local';
        rendererId: string;
        rendererLabel: string;
        options: Record<string, string>;
    }
    | {
        kind: 'remote';
        rendererId: string;
        rendererLabel: string;
        serverUrl: string;
        options: Record<string, string>;
    };

export interface RenderResult {
    data: string;
    diagnostics: RenderDiagnostic[];
    provenance: RenderProvenance;
}

export interface RenderCapabilities {
    language: string;
    local: boolean;
    rendererIds: string[];
    formats: string[];
}

export class RenderingError extends Error {
    readonly code: 'REMOTE_CONSENT_REQUIRED' | 'LOCAL_RENDER_FAILED' | 'REMOTE_RENDER_FAILED';
    readonly language: string;
    readonly diagnostics: RenderDiagnostic[];

    constructor(
        code: RenderingError['code'],
        language: string,
        message: string,
        diagnostics: RenderDiagnostic[] = [],
    ) {
        super(message);
        this.name = 'RenderingError';
        this.code = code;
        this.language = language;
        this.diagnostics = diagnostics;
    }
}

export interface RendererCatalog {
    find(language: string, environment: RenderEnvironment, format: string, rendererId?: string): RendererAdapter | undefined;
    capabilities(language: string, environment: RenderEnvironment): RenderCapabilities;
}

export const createRendererCatalog = (renderers: RendererAdapter[]): RendererCatalog => {
    const byId = new Map(renderers.map((renderer) => [renderer.id, renderer]));

    return {
        find(language, environment, format, rendererId) {
            const candidates = rendererId ? [byId.get(rendererId)] : renderers;
            return candidates.find((renderer) => (
                renderer?.languages.includes(language)
                && renderer.environments.includes(environment)
                && renderer.formats.includes(format)
            ));
        },
        capabilities(language, environment) {
            const matches = renderers.filter((renderer) => (
                renderer.languages.includes(language)
                && renderer.environments.includes(environment)
            ));
            return {
                language,
                local: matches.length > 0,
                rendererIds: matches.map((renderer) => renderer.id),
                formats: Array.from(new Set(matches.flatMap((renderer) => renderer.formats))),
            };
        },
    };
};

const diagnosticFrom = (rendererId: string, error: unknown): RenderDiagnostic => {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/(?:line|row)\s+(\d+)(?:[^\d]+column\s+(\d+))?/i);
    return {
        kind: 'fallback',
        message,
        rendererId,
        line: match ? Number(match[1]) : undefined,
        column: match?.[2] ? Number(match[2]) : undefined,
    };
};

export const createRenderingModule = ({
    catalog,
    environment,
    remoteRender,
}: {
    catalog: RendererCatalog;
    environment: RenderEnvironment;
    remoteRender: (input: RemoteRenderInput) => Promise<string>;
}) => {
    const loaded = new WeakSet<RendererAdapter>();
    const loading = new WeakMap<RendererAdapter, Promise<void>>();

    const ensureLoaded = (renderer: RendererAdapter): Promise<void> => {
        if (!renderer.load || loaded.has(renderer)) return Promise.resolve();
        const inFlight = loading.get(renderer);
        if (inFlight) return inFlight;
        const next = renderer.load()
            .then(() => { loaded.add(renderer); })
            .finally(() => { loading.delete(renderer); });
        loading.set(renderer, next);
        return next;
    };

    return {
        getCapabilities(language: string): RenderCapabilities {
            return catalog.capabilities(language, environment);
        },

        async render(request: RenderRequest): Promise<RenderResult> {
            const options = request.options || {};
            const localRenderer = catalog.find(
                request.language,
                environment,
                request.format,
                request.rendererId,
            );
            const diagnostics: RenderDiagnostic[] = [];

            if (localRenderer && localRenderer.remoteWhileLoading && request.remote && !loaded.has(localRenderer)) {
                void ensureLoaded(localRenderer).catch(() => {
                    // The remote result remains valid. A later local attempt can retry the warm-up.
                });
            } else if (localRenderer) {
                try {
                    await ensureLoaded(localRenderer);
                    const data = await localRenderer.render({
                        language: request.language,
                        source: request.source,
                        format: request.format,
                        options,
                    });
                    return {
                        data,
                        diagnostics,
                        provenance: {
                            kind: 'local',
                            rendererId: localRenderer.id,
                            rendererLabel: localRenderer.label,
                            options,
                        },
                    };
                } catch (error) {
                    diagnostics.push(diagnosticFrom(localRenderer.id, error));
                    if (!request.remote) {
                        throw new RenderingError(
                            'LOCAL_RENDER_FAILED',
                            request.language,
                            diagnostics[0].message,
                            diagnostics,
                        );
                    }
                }
            }

            if (!request.remote) {
                throw new RenderingError(
                    'REMOTE_CONSENT_REQUIRED',
                    request.language,
                    `${request.language} needs a render server, but none has consent`,
                    diagnostics,
                );
            }

            try {
                const data = await remoteRender({
                    language: request.language,
                    source: request.source,
                    format: request.format,
                    options,
                    serverUrl: request.remote.url,
                });
                return {
                    data,
                    diagnostics,
                    provenance: {
                        kind: 'remote',
                        rendererId: request.remote.id,
                        rendererLabel: request.remote.label,
                        serverUrl: request.remote.url,
                        options,
                    },
                };
            } catch (error) {
                const diagnostic = diagnosticFrom(request.remote.id, error);
                diagnostic.kind = 'render';
                throw new RenderingError(
                    'REMOTE_RENDER_FAILED',
                    request.language,
                    diagnostic.message,
                    [...diagnostics, diagnostic],
                );
            }
        },
    };
};
