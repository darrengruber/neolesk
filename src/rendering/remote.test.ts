import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKrokiRemoteAdapter } from './remote';

afterEach(() => vi.useRealTimers());

describe('Kroki-compatible remote adapter', () => {
    it('posts diagram source to the consented server without putting it in a URL', async () => {
        const fetchImpl = vi.fn(async () => new Response('<svg />', {
            status: 200,
            headers: { 'Content-Type': 'image/svg+xml' },
        }));
        const render = createKrokiRemoteAdapter(fetchImpl);

        await expect(render({
            language: 'ditaa',
            source: 'private architecture',
            format: 'svg',
            options: {},
            serverUrl: 'https://diagrams.darrengruber.com/render/',
        })).resolves.toBe('<svg />');

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://diagrams.darrengruber.com/render/ditaa/svg',
            expect.objectContaining({
                method: 'POST',
                body: 'private architecture',
                headers: expect.objectContaining({ 'Content-Type': 'text/plain; charset=utf-8' }),
            }),
        );
    });

    it('surfaces structured diagnostics from a rejected render', async () => {
        const render = createKrokiRemoteAdapter(async () => new Response(
            'Syntax error at line 4, column 7',
            { status: 400 },
        ));

        await expect(render({
            language: 'ditaa',
            source: 'broken',
            format: 'svg',
            options: {},
            serverUrl: 'https://example.test/',
        })).rejects.toMatchObject({
            message: 'Syntax error at line 4, column 7',
            status: 400,
            line: 4,
            column: 7,
        });
    });

    it('encodes hostile language and format values as path segments', async () => {
        let requestedUrl = '';
        const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
            requestedUrl = String(input);
            return new Response('<svg />');
        });
        const render = createKrokiRemoteAdapter(fetchImpl);

        await render({
            language: '//169.254.169.254/private',
            source: 'private',
            format: '/svg',
            options: {},
            serverUrl: 'http://kroki.internal:8080/',
        });

        expect(new URL(requestedUrl).origin).toBe('http://kroki.internal:8080');
        expect(requestedUrl).toBe('http://kroki.internal:8080/%2F%2F169.254.169.254%2Fprivate/%2Fsvg');
    });

    it('rejects an oversized renderer response without buffering it all', async () => {
        const render = createKrokiRemoteAdapter(
            async () => new Response(`<svg>${'x'.repeat(128)}</svg>`),
            { maxResponseBytes: 64 },
        );

        await expect(render({
            language: 'd2', source: 'a -> b', format: 'svg', options: {}, serverUrl: 'https://example.test/',
        })).rejects.toThrow('exceeds 64 bytes');
    });

    it('aborts a renderer that exceeds its deadline', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            if (!init?.signal) {
                reject(new Error('missing abort signal'));
                return;
            }
            init.signal.addEventListener('abort', () => reject(init.signal?.reason || new Error('aborted')));
        }));
        const render = createKrokiRemoteAdapter(fetchImpl as typeof fetch, { timeoutMs: 10 });
        const result = render({
            language: 'd2', source: 'a -> b', format: 'svg', options: {}, serverUrl: 'https://example.test/',
        });
        const expectation = expect(result).rejects.toThrow('timed out after 10ms');

        await vi.advanceTimersByTimeAsync(10);
        await expectation;
    });
});
