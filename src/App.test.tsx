import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PREFERENCES_KEY } from './preferences/preferences';

const { renderSpy } = vi.hoisted(() => ({ renderSpy: vi.fn() }));

vi.mock('./hooks/useDiagramRender', () => ({
    getBrowserRenderCapabilities: () => ({ local: true, rendererIds: ['test'], formats: ['svg'] }),
    useDiagramRender: (input: unknown) => {
        renderSpy(input);
        return {
            svgText: null,
            blobUrl: null,
            dimensions: null,
            loading: false,
            error: null,
            consentRequired: false,
            diagnostics: [],
            provenance: null,
        };
    },
}));

describe('neolesk editor shell', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        window.localStorage.clear();
        renderSpy.mockClear();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', {
            headers: { 'content-type': 'text/html' },
        })));
    });

    it('asks before any remote render and opens a local-only editor', async () => {
        render(<App />);

        expect(await screen.findByRole('heading', { name: 'Keep diagrams where you expect' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Diagram source' })).not.toBeInTheDocument();
        expect(renderSpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Render locally only' }));

        expect(await screen.findByRole('textbox', { name: 'Diagram source' })).toBeInTheDocument();
        expect(renderSpy).toHaveBeenCalledOnce();
        expect(screen.getByText('On this device')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
        expect(screen.getByText('Sessions unavailable in this deployment')).toBeInTheDocument();
    });

    it('uses an iOS-style tab bar on compact screens', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));

        const tabs = await screen.findByRole('tablist', { name: 'Editor sections' });
        expect(tabs).toBeInTheDocument();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
            'Code',
            'Preview',
            'Examples',
            'Settings',
        ]);
        expect(screen.getByRole('button', { name: 'Copy snapshot' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Code' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        const sheet = screen.getByRole('dialog', { name: 'Export diagram' });
        expect(sheet).toHaveAttribute('data-detent', 'compact');
        fireEvent.click(screen.getByRole('button', { name: 'Expand export options' }));
        expect(sheet).toHaveAttribute('data-detent', 'expanded');
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Preview' })).toBeInTheDocument();
        const preview = screen.getByRole('region', { name: 'Diagram preview' });
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        expect(preview).toHaveAttribute('data-zoom', '1.25');
    });

    it('keeps settings reachable at tablet width and exposes desktop manipulation controls', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));
        expect(await screen.findByRole('tab', { name: 'Settings' })).toBeInTheDocument();

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        window.dispatchEvent(new Event('resize'));
        expect(await screen.findByRole('button', { name: /Diagram language:/ })).toBeInTheDocument();
        expect(await screen.findByRole('separator', { name: 'Resize source and preview panes' })).toBeInTheDocument();
    });

    it('starts a live session when runtime discovery exposes the backend', async () => {
        const id = 'a'.repeat(64);
        class FakeWebSocket {
            static readonly OPEN = 1;
            readyState = 1;
            onopen: (() => void) | null = null;
            onmessage = null;
            onclose = null;
            send() { /* no-op */ }
            close() { /* no-op */ }
        }
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const path = new URL(String(input), window.location.origin).pathname;
            if (path === '/config.json') {
                return new Response(JSON.stringify({
                    renderServerUrl: 'https://diagrams.example/render/',
                    sessionBackendUrl: 'https://diagrams.example',
                }), { headers: { 'content-type': 'application/json' } });
            }
            return new Response(JSON.stringify({
                id,
                sessionUrl: `https://diagrams.example/s/${id}`,
                websocketUrl: `wss://diagrams.example/api/sessions/${id}/connect`,
                mcpUrl: `https://diagrams.example/mcp/${id}`,
            }), { status: 201, headers: { 'content-type': 'application/json' } });
        }));

        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));
        const newSession = await screen.findByRole('button', { name: 'New session' });
        await waitFor(() => expect(newSession).toBeEnabled());
        fireEvent.click(newSession);

        expect(await screen.findByText('Live session')).toBeInTheDocument();
        expect(window.location.pathname).toBe(`/s/${id}`);
        expect(screen.getByRole('button', { name: 'Copy agent URL' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Diagram source' }))
            .toHaveAttribute('contenteditable', 'false'));
        expect(within(screen.getByRole('listbox', { name: 'Diagram language' }))
            .getAllByRole('option').every((option) => option.hasAttribute('disabled'))).toBe(true);
    });

    it('invalidates remembered consent when runtime discovery changes render server', async () => {
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
            appearance: 'auto',
            editorWrapping: true,
            remoteRendering: 'neolesk',
            consentedRenderServer: 'https://old.example/render/',
            transparency: 0.72,
        }));
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            renderServerUrl: 'https://new.example/render/',
        }), { headers: { 'content-type': 'application/json' } })));

        render(<App />);

        expect(await screen.findByText(/new\.example/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Keep diagrams where you expect' })).toBeInTheDocument();
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('hydrates participant theme, zoom, and preview scroll from the addressable session view', async () => {
        const id = 'b'.repeat(64);
        window.history.replaceState(null, '', `/s/${id}`);
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
            appearance: 'auto',
            editorWrapping: true,
            remoteRendering: 'local-only',
            consentedRenderServer: null,
            transparency: 0.72,
        }));
        class FakeWebSocket {
            static readonly OPEN = 1;
            readyState = 1;
            onopen = null;
            onmessage = null;
            onclose = null;
            send() { /* no-op */ }
            close() { /* no-op */ }
        }
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const path = new URL(String(input), window.location.origin).pathname;
            if (path === '/config.json') {
                return new Response(JSON.stringify({
                    renderServerUrl: 'https://diagrams.example/render/',
                    sessionBackendUrl: 'https://diagrams.example',
                }), { headers: { 'content-type': 'application/json' } });
            }
            if (path.includes('/view/')) {
                return new Response(JSON.stringify({
                    theme: 'dark', zoom: 1.5, previewScrollTop: 22, previewScrollLeft: 11,
                }), { headers: { 'content-type': 'application/json' } });
            }
            return new Response('{}', { headers: { 'content-type': 'application/json' } });
        }));

        const { container } = render(<App />);
        const preview = await screen.findByRole('region', { name: 'Diagram preview' });
        await waitFor(() => expect(preview).toHaveAttribute('data-zoom', '1.5'));
        expect(container.querySelector('.App')).toHaveAttribute('data-appearance', 'dark');
        expect(preview.scrollTop).toBe(22);
        expect(preview.scrollLeft).toBe(11);
        expect(screen.getByText('Agent offline')).toBeInTheDocument();
    });

    it('leaves an expired session URL as an editable local snapshot', async () => {
        const id = 'c'.repeat(64);
        window.history.replaceState(null, '', `/s/${id}`);
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
            appearance: 'auto',
            editorWrapping: true,
            remoteRendering: 'local-only',
            consentedRenderServer: null,
            transparency: 0.72,
        }));
        const websocket = vi.fn();
        vi.stubGlobal('WebSocket', websocket);
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const path = new URL(String(input), window.location.origin).pathname;
            if (path === '/config.json') {
                return new Response(JSON.stringify({
                    renderServerUrl: 'https://diagrams.example/render/',
                    sessionBackendUrl: 'https://diagrams.example',
                }), { headers: { 'content-type': 'application/json' } });
            }
            return new Response(JSON.stringify({ error: 'Session not found' }), {
                status: 404, headers: { 'content-type': 'application/json' },
            });
        }));

        render(<App />);

        expect(await screen.findByText('Session expired. Continuing as a local snapshot.')).toBeInTheDocument();
        expect(window.location.pathname).toBe('/');
        expect(screen.queryByText('Live session')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveAttribute('contenteditable', 'true');
        expect(websocket).not.toHaveBeenCalled();
    });
});
