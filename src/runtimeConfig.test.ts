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

    it('discovers render and session capabilities independently', async () => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond(JSON.stringify({
            renderServerUrl: 'https://diagrams.example/render/',
            sessionBackendUrl: 'https://diagrams.example/',
        }), { contentType: 'application/json' })));

        expect(outcome).toEqual({
            status: 'loaded',
            config: {
                renderServerUrl: 'https://diagrams.example/render/',
                sessionBackendUrl: 'https://diagrams.example',
            },
        });
    });

    it('trims and canonicalizes deployment URLs', async () => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond(JSON.stringify({
            renderServerUrl: '  https://diagrams.example/render  ',
            sessionBackendUrl: ' https://diagrams.example/ ',
        }), { contentType: 'application/json' })));

        expect(outcome).toEqual({
            status: 'loaded',
            config: {
                renderServerUrl: 'https://diagrams.example/render/',
                sessionBackendUrl: 'https://diagrams.example',
            },
        });
    });

    it('rejects an empty session backend instead of advertising a broken feature', async () => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond(JSON.stringify({
            sessionBackendUrl: ' ',
        }), { contentType: 'application/json' })));

        expect(outcome.status).toBe('invalid');
    });

    it.each([
        ['not a url', 'renderServerUrl'],
        ['file:///etc/passwd', 'renderServerUrl'],
        ['javascript:alert(1)', 'sessionBackendUrl'],
    ])('rejects unsafe or malformed runtime URL %s', async (value, key) => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond(JSON.stringify({
            [key]: value,
        }), { contentType: 'application/json' })));

        expect(outcome).toEqual(expect.objectContaining({ status: 'invalid' }));
    });

    it.each([
        'https://user:secret@diagrams.example/',
        'https://diagrams.example/base/',
        'https://diagrams.example/?tenant=x',
        'https://diagrams.example/#fragment',
    ])('rejects a session backend that is not a plain origin: %s', async (sessionBackendUrl) => {
        const outcome = await loadRuntimeConfig(fetchReturning(respond(JSON.stringify({
            sessionBackendUrl,
        }), { contentType: 'application/json' })));

        expect(outcome).toEqual(expect.objectContaining({ status: 'invalid' }));
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
