import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig } from './runtimeConfig';

const respond = (body: string, init: { status?: number; contentType?: string } = {}) =>
    new Response(body, {
        status: init.status ?? 200,
        headers: init.contentType ? { 'content-type': init.contentType } : {},
    });

const fetchReturning = (response: Response | Promise<never>) =>
    vi.fn(() => (response instanceof Response ? Promise.resolve(response) : response)) as unknown as typeof fetch;

describe('loadRuntimeConfig', () => {
    it('applies a valid config', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(
                respond(JSON.stringify({ krokiEngineUrl: 'https://kroki.example/' }), {
                    contentType: 'application/json',
                }),
            ),
        );

        expect(outcome).toEqual({
            status: 'loaded',
            config: { krokiEngineUrl: 'https://kroki.example/' },
        });
    });

    // The regression this module exists for. Every host serving this app has an
    // SPA fallback, so a MISSING config.json comes back as 200 + index.html.
    // The old code called res.json() on that, threw, and swallowed it — making
    // "not deployed" and "deployed but broken" both silent.
    it('treats the SPA fallback (200 + HTML) as no config, not an error', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(respond('<!DOCTYPE html><html></html>', { contentType: 'text/html' })),
        );

        expect(outcome).toEqual({ status: 'absent' });
    });

    it('reports a config that is served as JSON but does not parse', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(respond('{ not json', { contentType: 'application/json' })),
        );

        expect(outcome.status).toBe('invalid');
    });

    it('reports a non-string krokiEngineUrl', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(
                respond(JSON.stringify({ krokiEngineUrl: 42 }), { contentType: 'application/json' }),
            ),
        );

        expect(outcome.status).toBe('invalid');
    });

    it('reports an empty krokiEngineUrl rather than silently using it', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(
                respond(JSON.stringify({ krokiEngineUrl: '   ' }), { contentType: 'application/json' }),
            ),
        );

        expect(outcome.status).toBe('invalid');
    });

    it('reports a JSON array', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(respond('[]', { contentType: 'application/json' })),
        );

        expect(outcome.status).toBe('invalid');
    });

    it('accepts a config object that sets no engine', async () => {
        const outcome = await loadRuntimeConfig(
            fetchReturning(respond('{}', { contentType: 'application/json' })),
        );

        expect(outcome).toEqual({ status: 'loaded', config: {} });
    });

    it('treats an honest 404 as no config', async () => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond('nope', { status: 404 })));

        expect(outcome).toEqual({ status: 'absent' });
    });

    it('reports a server error', async () => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond('boom', { status: 503 })));

        expect(outcome.status).toBe('invalid');
    });

    // A deployment concern must never be able to take the editor down.
    it('never throws when the fetch itself rejects', async () => {
        const outcome = await loadRuntimeConfig(fetchReturning(Promise.reject(new Error('offline'))));

        expect(outcome).toEqual({ status: 'absent' });
    });
});
