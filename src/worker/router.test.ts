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

    it('rejects malformed session identifiers before touching Durable Objects', async () => {
        const router = createWorkerRouter({ namespace, assetFetch, krokiFetch });
        expect((await router.fetch(new Request('https://diagrams.example/api/sessions/not-a-cell/state'))).status).toBe(404);
        expect(cellFetch).not.toHaveBeenCalled();
    });
});
