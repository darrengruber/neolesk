import { describe, expect, it, vi } from 'vitest';
import { createKrokiRemoteAdapter } from './remote';

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
});
