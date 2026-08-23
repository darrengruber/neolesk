import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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

        expect(screen.getByRole('heading', { name: 'Keep diagrams where you expect' })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Render locally only' }));

        const tabs = await screen.findByRole('tablist', { name: 'Editor sections' });
        expect(tabs).toBeInTheDocument();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
            'Code',
            'Preview',
            'Examples',
            'Settings',
        ]);
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
        fireEvent.click(screen.getByRole('button', { name: 'Render locally only' }));
        const newSession = await screen.findByRole('button', { name: 'New session' });
        await waitFor(() => expect(newSession).toBeEnabled());
        fireEvent.click(newSession);

        expect(await screen.findByText('Live session')).toBeInTheDocument();
        expect(window.location.pathname).toBe(`/s/${id}`);
        expect(screen.getByRole('button', { name: 'Copy agent URL' })).toBeInTheDocument();
    });
});
