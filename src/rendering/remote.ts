import { diagramMetadata } from '../kroki/metadata';
import type { RemoteRenderer, RemoteRenderInput } from './rendering';
import { D2_OPTION_DEFINITIONS, GRAPHVIZ_OPTION_DEFINITIONS } from './rendererOptions';

export const createKrokiRemoteRenderer = ({
    id,
    label,
    url,
}: Pick<RemoteRenderer, 'id' | 'label' | 'url'>): RemoteRenderer => ({
    id,
    label,
    url,
    capabilities: Object.fromEntries(Object.entries(diagramMetadata).map(([language, definition]) => [
        language,
        {
            formats: definition.filetypes,
            optionDefinitions: language === 'd2'
                ? D2_OPTION_DEFINITIONS
                : language === 'graphviz' ? GRAPHVIZ_OPTION_DEFINITIONS : {},
        },
    ])),
});

export class RemoteRenderError extends Error {
    readonly status: number;
    readonly line?: number;
    readonly column?: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'RemoteRenderError';
        this.status = status;
        const location = message.match(/(?:line|row)\s+(\d+)(?:[^\d]+column\s+(\d+))?/i);
        this.line = location ? Number(location[1]) : undefined;
        this.column = location?.[2] ? Number(location[2]) : undefined;
    }
}

export class RemoteResponseTooLargeError extends Error {
    constructor(readonly limit: number) {
        super(`Render server response exceeds ${limit} bytes`);
        this.name = 'RemoteResponseTooLargeError';
    }
}

export const readResponseBytes = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new RemoteResponseTooLargeError(maxBytes);
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new RemoteResponseTooLargeError(maxBytes);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
};

export const withRenderDeadline = async <T>(
    timeoutMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Render server timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
        return await operation(controller.signal);
    } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

export const createKrokiEndpoint = (
    serverUrl: string,
    language: string,
    format: string,
    options: Record<string, string> = {},
): URL => {
    const base = new URL(serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`);
    const url = new URL(`${encodeURIComponent(language)}/${encodeURIComponent(format)}`, base);
    if (url.origin !== base.origin) throw new Error('Render target escaped the configured Kroki origin');
    Object.entries(options).forEach(([key, value]) => url.searchParams.set(key, value));
    return url;
};

export const createKrokiRemoteAdapter = (
    fetchImpl: typeof fetch = fetch,
    limits: { timeoutMs?: number; maxResponseBytes?: number } = {},
) => async ({ language, source, format, options, serverUrl }: RemoteRenderInput): Promise<string> => {
    const url = createKrokiEndpoint(serverUrl, language, format, options);
    const timeoutMs = limits.timeoutMs ?? 15_000;
    const maxResponseBytes = limits.maxResponseBytes ?? 8 * 1024 * 1024;

    return withRenderDeadline(timeoutMs, async (signal) => {
        const response = await fetchImpl(url.toString(), {
            method: 'POST',
            body: source,
            signal,
            headers: {
                Accept: format === 'svg' ? 'image/svg+xml' : `image/${format}`,
                'Content-Type': 'text/plain; charset=utf-8',
            },
        });
        const body = new TextDecoder().decode(await readResponseBytes(response, maxResponseBytes));

        if (!response.ok) {
            throw new RemoteRenderError(body.trim() || `Render server returned HTTP ${response.status}`, response.status);
        }
        if (format === 'svg' && !body.includes('<svg')) {
            throw new RemoteRenderError('Render server did not return SVG', response.status);
        }
        return body;
    });
};
