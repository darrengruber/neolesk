import { RenderingError, type RemoteRenderer } from '../rendering/rendering';
import { createKrokiEndpoint, readResponseBytes, withRenderDeadline } from '../rendering/remote';
import type { LocalExporter } from './localExport';

export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'pdf';

export interface RemoteExportInput {
    format: Exclude<ExportFormat, 'svg'>;
    language: string;
    source: string;
    serverUrl: string;
}

export type RemoteExport = (input: RemoteExportInput) => Promise<Blob>;

/** The file, and where it was made: the status line says which (CONTEXT.md, render provenance). */
export interface ExportResult {
    blob: Blob;
    madeOn: 'device' | 'server';
}

export const createRemoteExportAdapter = (
    fetchImpl: typeof fetch = fetch,
    limits: { timeoutMs?: number; maxResponseBytes?: number } = {},
): RemoteExport => async ({
    format,
    language,
    source,
    serverUrl,
}) => {
    const timeoutMs = limits.timeoutMs ?? 30_000;
    const maxResponseBytes = limits.maxResponseBytes ?? 32 * 1024 * 1024;
    return withRenderDeadline(timeoutMs, async (signal) => {
        const response = await fetchImpl(createKrokiEndpoint(serverUrl, language, format), {
            method: 'POST',
            body: source,
            signal,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
        const data = await readResponseBytes(response, maxResponseBytes);
        if (!response.ok) {
            const message = new TextDecoder().decode(data).trim();
            throw new Error(message || `Export server returned HTTP ${response.status}`);
        }
        return new Blob([Uint8Array.from(data)], {
            type: response.headers.get('content-type') || `image/${format}`,
        });
    });
};

/** The cell answers errors as JSON `{ "error": "..." }`; show the message, not the JSON. */
const failureMessage = async (response: Response, fallback: string): Promise<string> => {
    const text = (await response.text()).trim();
    try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    } catch {
        // Not JSON: a proxy or the render server answered in plain text.
    }
    return text || fallback;
};

export const createSessionExportAdapter = ({
    backendUrl,
    sessionId,
    participantId,
    rendererId,
    fetchImpl = fetch,
}: {
    backendUrl: string;
    sessionId: string;
    participantId: string;
    rendererId: 'neolesk' | 'kroki-io';
    fetchImpl?: typeof fetch;
}): RemoteExport => async ({ format }) => {
    const response = await fetchImpl(
        new URL(`/api/sessions/${encodeURIComponent(sessionId)}/export`, backendUrl).href,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ format, participantId, rendererId }),
        },
    );
    if (!response.ok) {
        throw new Error(await failureMessage(response, `Session export failed with HTTP ${response.status}`));
    }
    return response.blob();
};

export const createManagedCellExportAdapter = ({
    backendUrl,
    rendererId,
    fetchImpl = fetch,
}: {
    backendUrl: string;
    rendererId: 'neolesk' | 'kroki-io';
    fetchImpl?: typeof fetch;
}): RemoteExport => async ({ format, language, source }) => {
    const base = new URL('/', backendUrl).href;
    const created = await fetchImpl(new URL('/api/sessions', base).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language, source }),
    });
    if (!created.ok) {
        throw new Error(await failureMessage(created, `Could not create export cell (HTTP ${created.status})`));
    }
    const session = await created.json() as { id?: unknown };
    if (typeof session.id !== 'string' || !/^[0-9a-f]{64}$/i.test(session.id)) {
        throw new Error('Export cell returned an invalid session identifier');
    }
    try {
        return await createSessionExportAdapter({
            backendUrl: base,
            sessionId: session.id,
            participantId: 'managed-export',
            rendererId,
            fetchImpl,
        })({ format, language, source, serverUrl: '' });
    } finally {
        await fetchImpl(new URL(`/api/sessions/${encodeURIComponent(session.id)}/close`, base).href, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ actor: 'human' }),
        }).catch(() => undefined);
    }
};

export const exportDiagram = async ({
    format,
    svg,
    language,
    source,
    remote,
    remoteExport,
    local,
}: {
    format: ExportFormat;
    svg: string;
    language: string;
    source: string;
    remote: RemoteRenderer | null;
    remoteExport: RemoteExport;
    /** Makes PNG, JPEG and PDF on this device; the server is only the fallback (ADR 0021). */
    local?: LocalExporter;
}): Promise<ExportResult> => {
    if (format === 'svg') {
        return { blob: new Blob([svg], { type: 'image/svg+xml' }), madeOn: 'device' };
    }
    let localReason: string | null = null;
    if (local) {
        const prepared = await local.prepare({ svg, language, source });
        if ('svg' in prepared) {
            try {
                return { blob: await local.export(prepared.svg, format), madeOn: 'device' };
            } catch {
                // A canvas the browser taints anyway, or a picture too large
                // to encode: the server can still make it.
                localReason = 'this browser could not draw it';
            }
        } else {
            localReason = prepared.reason;
        }
    }
    if (!remote) {
        throw new RenderingError(
            'REMOTE_CONSENT_REQUIRED',
            language,
            localReason
                ? `${format.toUpperCase()} export of this diagram needs a render server, because ${localReason}`
                : `${format.toUpperCase()} export needs a consented render server`,
        );
    }
    const serverFormats = remote.capabilities[language]?.formats;
    if (serverFormats && !serverFormats.includes(format)) {
        throw new RenderingError(
            'REMOTE_RENDER_FAILED',
            language,
            `${format.toUpperCase()} export is not available for this diagram language`,
        );
    }
    return {
        blob: await remoteExport({
            format,
            language,
            source,
            serverUrl: remote.url,
        }),
        madeOn: 'server',
    };
};
