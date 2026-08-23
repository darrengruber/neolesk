import { RenderingError, type RemoteRenderer } from '../rendering/rendering';

export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'pdf';

export interface RemoteExportInput {
    format: Exclude<ExportFormat, 'svg'>;
    language: string;
    source: string;
    serverUrl: string;
}

export type RemoteExport = (input: RemoteExportInput) => Promise<Blob>;

export const createRemoteExportAdapter = (fetchImpl: typeof fetch = fetch): RemoteExport => async ({
    format,
    language,
    source,
    serverUrl,
}) => {
    const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
    const response = await fetchImpl(new URL(`${encodeURIComponent(language)}/${format}`, base), {
        method: 'POST',
        body: source,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
    if (!response.ok) {
        throw new Error((await response.text()).trim() || `Export server returned HTTP ${response.status}`);
    }
    return response.blob();
};

export const exportDiagram = async ({
    format,
    svg,
    language,
    source,
    remote,
    remoteExport,
}: {
    format: ExportFormat;
    svg: string;
    language: string;
    source: string;
    remote: RemoteRenderer | null;
    remoteExport: RemoteExport;
}): Promise<Blob> => {
    if (format === 'svg') {
        return new Blob([svg], { type: 'image/svg+xml' });
    }
    if (!remote) {
        throw new RenderingError(
            'REMOTE_CONSENT_REQUIRED',
            language,
            `${format.toUpperCase()} export needs a consented render server`,
        );
    }
    return remoteExport({
        format,
        language,
        source,
        serverUrl: remote.url,
    });
};
