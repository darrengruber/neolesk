import type { RemoteRenderInput } from './rendering';

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

export const createKrokiRemoteAdapter = (
    fetchImpl: typeof fetch = fetch,
) => async ({ language, source, format, options, serverUrl }: RemoteRenderInput): Promise<string> => {
    const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
    const url = new URL(`${encodeURIComponent(language)}/${encodeURIComponent(format)}`, base);
    Object.entries(options).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetchImpl(url.toString(), {
        method: 'POST',
        body: source,
        headers: {
            Accept: format === 'svg' ? 'image/svg+xml' : `image/${format}`,
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
    const body = await response.text();

    if (!response.ok) {
        throw new RemoteRenderError(body.trim() || `Render server returned HTTP ${response.status}`, response.status);
    }
    if (format === 'svg' && !body.includes('<svg')) {
        throw new RemoteRenderError('Render server did not return SVG', response.status);
    }
    return body;
};
