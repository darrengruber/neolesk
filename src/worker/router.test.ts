import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerRouter, type SessionNamespace } from './router';

const SESSION_ID = 'a'.repeat(64);

describe('Worker public URL surface', () => {
    let cellFetch: ReturnType<typeof vi.fn>;
    let namespace: SessionNamespace;
    let assetFetch: ReturnType<typeof vi.fn>;
    let krokiFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        cellFetch = vi.fn(async (request: Request) => new Response(request.body, {
            status: request.url.endsWith('/initialize') ? 201 : 200,
            headers: { 'content-type': 'application/json' },
        }));
        namespace = {
            newUniqueId: () => ({ toString: () => SESSION_ID }),
            idFromString: (value) => ({ toString: () => value }),
            get: () => ({ fetch: cellFetch }),
        };
        assetFetch = vi.fn(async (request: Request) => new Response(`asset:${new URL(request.url).pathname}`));
        krokiFetch = vi.fn(async (request: Request) => new Response(`kroki:${new URL(request.url).pathname}`));
    });

    it('creates an unguessable session and returns its human, websocket, and MCP URLs', async () => {
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });
        const response = await router.fetch(new Request('https://diagrams.example/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
            id: SESSION_ID,
            sessionUrl: `https://diagrams.example/s/${SESSION_ID}`,
            websocketUrl: `wss://diagrams.example/api/sessions/${SESSION_ID}/connect`,
            mcpUrl: `https://diagrams.example/mcp/${SESSION_ID}`,
        });
        expect(cellFetch).toHaveBeenCalledOnce();
        expect(new URL(cellFetch.mock.calls[0][0].url).pathname).toBe('/initialize');
    });

    it('publishes runtime discovery and keeps the static app on session URLs', async () => {
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });

        const config = await router.fetch(new Request('https://diagrams.example/config.json'));
        expect(await config.json()).toEqual({
            renderServerUrl: 'https://diagrams.example/render/',
            sessionBackendUrl: 'https://diagrams.example',
        });

        expect(await (await router.fetch(new Request(`https://diagrams.example/s/${SESSION_ID}`))).text()).toBe('asset:/');
    });

    it('proxies render requests to the private Kroki origin without exposing it', async () => {
        const router = createWorkerRouter({
            namespace,
            assetFetch,
            krokiFetch,
            krokiOrigin: 'http://kroki.kroki.svc.cluster.local:8000/',
        });
        const response = await router.fetch(new Request('https://diagrams.example/render/plantuml/svg', {
            method: 'POST',
            body: '@startuml\n@enduml',
        }));

        expect(await response.text()).toBe('kroki:/plantuml/svg');
        expect(new URL(krokiFetch.mock.calls[0][0].url).origin).toBe('http://kroki.kroki.svc.cluster.local:8000');
    });

    it('never lets a render path replace the configured Kroki origin', async () => {
        const router = createWorkerRouter({
            namespace,
            assetFetch,
            krokiFetch,
            krokiOrigin: 'http://kroki.kroki.svc.cluster.local:8000/',
        });

        const response = await router.fetch(new Request('https://diagrams.example/render///169.254.169.254/latest/meta-data'));

        expect(response.status).toBe(400);
        expect(krokiFetch).not.toHaveBeenCalled();
    });

    it('rejects malformed session identifiers before touching Durable Objects', async () => {
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });
        expect((await router.fetch(new Request('https://diagrams.example/api/sessions/not-a-cell/state'))).status).toBe(404);
        expect(cellFetch).not.toHaveBeenCalled();
    });

    it('routes the non-touching session presence probe to the cell', async () => {
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });

        await router.fetch(new Request(`https://diagrams.example/api/sessions/${SESSION_ID}/presence`));

        expect(cellFetch).toHaveBeenCalledOnce();
        expect(new URL(cellFetch.mock.calls[0][0].url).pathname).toBe('/presence');
        expect(assetFetch).not.toHaveBeenCalled();
    });

    it('keeps browser renders and binary exports inside the session cell', async () => {
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });

        for (const action of ['render', 'export']) {
            await router.fetch(new Request(`https://diagrams.example/api/sessions/${SESSION_ID}/${action}`, {
                method: 'POST', body: JSON.stringify({ participantId: 'human', format: action === 'render' ? 'svg' : 'png' }),
            }));
        }

        expect(cellFetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(['/render', '/export']);
        expect(assetFetch).not.toHaveBeenCalled();
    });

    it('rate-limits public session creation and Kroki proxy work by client', async () => {
        const router = createWorkerRouter({
            namespace, assetFetch, krokiFetch,
            limits: { maxSessionCreationsPerMinute: 1, maxProxyRendersPerMinute: 1 },
        });
        const clientHeaders = { 'cf-connecting-ip': '203.0.113.5' };
        const create = () => router.fetch(new Request('https://diagrams.example/api/sessions', {
            method: 'POST', headers: clientHeaders,
            body: JSON.stringify({ language: 'd2', source: 'a -> b' }),
        }));
        const render = () => router.fetch(new Request('https://diagrams.example/render/d2/svg', {
            method: 'POST', headers: clientHeaders, body: 'a -> b',
        }));

        expect((await create()).status).toBe(201);
        const limitedCreate = await create();
        expect(limitedCreate.status).toBe(429);
        expect(limitedCreate.headers.get('retry-after')).toBe('60');
        expect((await render()).status).toBe(200);
        const limitedRender = await render();
        expect(limitedRender.status).toBe(429);
        expect(limitedRender.headers.get('retry-after')).toBe('60');
    });

    it('rejects oversized public bodies before creating cells or forwarding to Kroki', async () => {
        const router = createWorkerRouter({
            namespace, assetFetch, krokiFetch, limits: { maxRequestBodyBytes: 64 },
        });
        expect((await router.fetch(new Request('https://diagrams.example/api/sessions', {
            method: 'POST', body: JSON.stringify({ language: 'd2', source: 'x'.repeat(128) }),
        }))).status).toBe(413);
        expect((await router.fetch(new Request('https://diagrams.example/render/d2/svg', {
            method: 'POST', body: 'x'.repeat(128),
        }))).status).toBe(413);
        expect(cellFetch).not.toHaveBeenCalled();
        expect(krokiFetch).not.toHaveBeenCalled();
    });

    it('bounds concurrent public Kroki proxy work', async () => {
        let release = () => {};
        krokiFetch.mockImplementation(async () => {
            await new Promise<void>((resolve) => { release = resolve; });
            return new Response('rendered');
        });
        const router = createWorkerRouter({
            namespace, assetFetch, krokiFetch,
            limits: { maxConcurrentProxyRenders: 1 },
        });
        const render = () => router.fetch(new Request('https://diagrams.example/render/d2/svg', {
            method: 'POST', body: 'a -> b',
        }));

        const first = render();
        await vi.waitFor(() => expect(krokiFetch).toHaveBeenCalledOnce());
        const limited = await render();
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('1');
        release();
        expect((await first).status).toBe(200);
    });

    it('aborts stalled Kroki proxy work at the configured deadline', async () => {
        krokiFetch.mockImplementation(async (_request: Request, init?: RequestInit) => {
            const signal = init?.signal as AbortSignal;
            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('<svg'));
                    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
                },
            }), { headers: { 'content-type': 'image/svg+xml' } });
        });
        const router = createWorkerRouter({
            namespace, assetFetch, krokiFetch,
            limits: { maxProxyRenderMs: 250, maxConcurrentProxyRenders: 1 },
        });

        const pending = router.fetch(new Request('https://diagrams.example/render/d2/svg', {
            method: 'POST', body: 'a -> b',
        }));
        await vi.waitFor(() => expect(krokiFetch).toHaveBeenCalledOnce());
        const concurrent = await router.fetch(new Request('https://diagrams.example/render/d2/svg', {
            method: 'POST', body: 'a -> b',
        }));
        expect(concurrent.status).toBe(429);
        const response = await pending;
        expect(response.status).toBe(504);
        expect(await response.json()).toEqual({ error: 'Render server timed out after 250ms' });
    });

    it('propagates client cancellation to Kroki proxy work', async () => {
        const seenSignal = vi.fn();
        krokiFetch.mockImplementation((_request: Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal;
            seenSignal(signal);
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const controller = new AbortController();
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });
        const request = new Request('https://diagrams.example/render/d2/svg', {
            method: 'POST', body: 'a -> b',
        });
        Object.defineProperty(request, 'signal', { value: controller.signal });
        const pending = router.fetch(request);
        await vi.waitFor(() => expect(seenSignal).toHaveBeenCalledOnce());

        controller.abort(new Error('client left'));

        await expect(pending).rejects.toThrow('client left');
        expect(seenSignal.mock.calls[0][0].aborted).toBe(true);
    });
});
