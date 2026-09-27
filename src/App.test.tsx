import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PREFERENCES_KEY } from './preferences/preferences';
import { buildDiagramState } from './state';

const { renderSpy, rendered } = vi.hoisted(() => ({
    renderSpy: vi.fn(),
    rendered: { current: null as null | { svgText: string; blobUrl: string; dimensions: { width: number; height: number } } },
}));

vi.mock('./hooks/useDiagramRender', () => ({
    getBrowserRenderCapabilities: () => ({ local: true, rendererIds: ['test'], formats: ['svg'] }),
    useDiagramRender: (input: unknown) => {
        renderSpy(input);
        return {
            svgText: rendered.current?.svgText ?? null,
            blobUrl: rendered.current?.blobUrl ?? null,
            dimensions: rendered.current?.dimensions ?? null,
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
        window.sessionStorage.clear();
        renderSpy.mockClear();
        rendered.current = null;
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
        expect(screen.getByRole('heading', { level: 1, name: 'Code' })).toBeInTheDocument();
        expect(screen.getByRole('tabpanel', { name: 'Code' })).toBeInTheDocument();
        // One Share button replaces the desktop toolbar on a phone.
        expect(screen.queryByRole('button', { name: 'Copy snapshot' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Diagram language: PlantUML/ })).toHaveAccessibleDescription(/On this device/);

        fireEvent.click(screen.getByRole('button', { name: 'Share and export' }));
        const sheet = screen.getByRole('dialog', { name: 'Share and Export' });
        expect(within(sheet).getByRole('button', { name: 'Copy Snapshot Link' })).toBeEnabled();
        expect(within(sheet).getByRole('button', { name: 'New Session' })).toBeDisabled();
        expect(within(sheet).getByText('Sessions unavailable in this deployment.')).toBeInTheDocument();
        expect(within(sheet).getByRole('button', { name: /^PNG/ })).toBeDisabled();
        expect(within(sheet).getAllByText('Needs a render server')).toHaveLength(3);
        fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog', { name: 'Share and Export' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Preview' })).toBeInTheDocument();
        const preview = screen.getByRole('region', { name: 'Diagram preview' });
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        expect(preview).toHaveAttribute('data-zoom', '1.25');
        fireEvent.click(screen.getByRole('button', { name: 'Reset zoom, now 125 percent' }));
        expect(preview).toHaveAttribute('data-zoom', '1');
    });

    it('moves between tabs with the arrow keys and keeps the section through a reload', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        const { unmount } = render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));

        const code = await screen.findByRole('tab', { name: 'Code' });
        expect(code).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(code, { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Preview' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Preview' }), { key: 'End' });
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();

        unmount();
        const { unmount: unmountReload } = render(<App />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();

        // A different snapshot link opened in the same tab starts on its preview.
        unmountReload();
        window.history.replaceState(null, '', `/#${buildDiagramState({
            baseUrl: `${window.location.origin}/`,
            diagramType: 'graphviz',
            diagramText: 'digraph { a -> b }',
            filetype: 'svg',
            renderUrl: 'https://diagrams.example/render/',
        }).diagramHash}`);
        render(<App />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Preview' })).toBeInTheDocument();
    });

    it('opens an example through a language drill-in and returns with focus on the row', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'Examples' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Examples' })).toBeInTheDocument();
        const current = screen.getByRole('region', { name: 'Current Language' });
        fireEvent.click(within(current).getByRole('button', { name: /PlantUML/ }));
        expect(screen.getByRole('heading', { level: 1, name: 'PlantUML' })).toHaveFocus();

        fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
        await waitFor(() => expect(within(screen.getByRole('region', { name: 'Current Language' }))
            .getByRole('button', { name: /PlantUML/ })).toHaveFocus());

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: 'zzzz' } });
        expect(screen.getByText('No Results for “zzzz”')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: 'mermaid flowchart' } });
        const results = screen.getByRole('region', { name: 'Mermaid' });
        fireEvent.click(within(results).getAllByRole('button')[0]);

        // A phone shows the example it just opened.
        expect(screen.getByRole('heading', { level: 1, name: 'Preview' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Diagram language: Mermaid/ })).toBeInTheDocument();
    });

    it('changes the diagram language from a searchable sheet', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));

        fireEvent.click(screen.getByRole('button', { name: /Diagram language: PlantUML/ }));
        const sheet = screen.getByRole('dialog', { name: 'Diagram Language' });
        expect(within(sheet).getByRole('radio', { name: 'PlantUML' })).toBeChecked();
        expect(within(sheet).getByRole('region', { name: 'On This Device' })).toBeInTheDocument();
        fireEvent.change(within(sheet).getByRole('searchbox', { name: 'Search languages' }), { target: { value: 'grap' } });
        fireEvent.click(within(sheet).getByRole('radio', { name: 'GraphViz' }));

        expect(screen.queryByRole('dialog', { name: 'Diagram Language' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Diagram language: GraphViz/ })).toBeInTheDocument();
    });

    it('groups settings the iOS way', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));

        fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
        expect(document.querySelector('.App')).toHaveAttribute('data-appearance', 'dark');
        const wrap = screen.getByRole('switch', { name: 'Wrap Long Lines' });
        expect(wrap).toBeChecked();
        fireEvent.click(wrap);
        expect(wrap).not.toBeChecked();
        expect(screen.getByRole('radio', { name: /On This Device Only/ })).toBeChecked();
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });

    it('prints only the rendered diagram, from any tab', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        const print = vi.fn();
        vi.stubGlobal('print', print);
        const { container } = render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));

        // Nothing has rendered: say so instead of printing a blank page.
        expect(container.querySelector('.PrintDiagram')).toHaveTextContent('Nothing to print yet');
        fireEvent.click(screen.getByRole('button', { name: 'Share and export' }));
        expect(screen.getByRole('button', { name: 'Print…' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });

    it('offers Print once the diagram renders, and prints a wide diagram in landscape', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        rendered.current = { svgText: '<svg/>', blobUrl: 'blob:diagram', dimensions: { width: 800, height: 300 } };
        const print = vi.fn();
        vi.stubGlobal('print', print);
        const { container } = render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));

        const printable = container.querySelector('.PrintDiagram');
        expect(printable).toHaveAttribute('data-orientation', 'landscape');
        expect(printable?.querySelector('img')).toHaveAttribute('src', 'blob:diagram');

        fireEvent.click(screen.getByRole('button', { name: 'Share and export' }));
        fireEvent.click(screen.getByRole('button', { name: 'Print…' }));
        expect(screen.queryByRole('dialog', { name: 'Share and Export' })).not.toBeInTheDocument();
        await waitFor(() => expect(print).toHaveBeenCalledOnce());
    });

    it('offers every export format when this device can draw the diagram, with no render server', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        rendered.current = { svgText: '<svg xmlns="http://www.w3.org/2000/svg"/>', blobUrl: 'blob:diagram', dimensions: { width: 300, height: 300 } };
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));

        fireEvent.click(await screen.findByRole('button', { name: 'Share and export' }));
        const sheet = screen.getByRole('dialog', { name: 'Share and Export' });
        for (const format of ['SVG', 'PNG', 'JPEG', 'PDF']) {
            expect(within(sheet).getByRole('button', { name: new RegExp(`^${format}`) })).toBeEnabled();
        }
        expect(within(sheet).getByText('Every format is made on this device. Nothing leaves it. Print… makes a vector PDF.')).toBeInTheDocument();
    });

    it('offers only the export formats that the render server can make when this device cannot draw the diagram', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        // HTML labels taint a canvas, so the render server makes the other formats.
        rendered.current = {
            svgText: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
            blobUrl: 'blob:diagram',
            dimensions: { width: 300, height: 300 },
        };
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
            appearance: 'light',
            editorWrapping: true,
            remoteRendering: 'neolesk',
            consentedRenderServer: 'https://diagrams.example/render/',
            transparency: 1,
        }));
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            renderServerUrl: 'https://diagrams.example/render/',
        }), { headers: { 'content-type': 'application/json' } })));
        render(<App />);

        fireEvent.click(await screen.findByRole('button', { name: 'Share and export' }));
        const sheet = screen.getByRole('dialog', { name: 'Share and Export' });
        // PlantUML: the render server makes PNG and PDF, but answers JPEG with HTTP 400.
        expect(within(sheet).getByRole('button', { name: /^SVG/ })).toBeEnabled();
        expect(within(sheet).getByRole('button', { name: /^PNG/ })).toBeEnabled();
        expect(within(sheet).getByRole('button', { name: /^PDF/ })).toBeEnabled();
        expect(within(sheet).getByRole('button', { name: /^JPEG/ })).toBeDisabled();
        expect(within(sheet).getByRole('button', { name: /^JPEG/ })).toHaveTextContent('Not available for PlantUML');
    });

    it('keeps settings reachable at tablet width and exposes desktop manipulation controls', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Render locally only' }));
        expect(await screen.findByRole('tab', { name: 'Settings' })).toBeInTheDocument();
        // Regular width puts source and preview side by side under one Editor tab.
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Editor', 'Examples', 'Settings']);
        expect(screen.getByRole('textbox', { name: 'Diagram source' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Diagram preview' })).toBeInTheDocument();

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        window.dispatchEvent(new Event('resize'));
        // Both layouts have a language button, so wait for the switch before asserting.
        await waitFor(() => expect(document.querySelector('.App')).toHaveAttribute('data-layout', 'wide'));
        expect(screen.getByRole('button', { name: /Diagram language:/ })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: /Diagram language:/ }));
        expect(within(screen.getByRole('radiogroup', { name: 'Diagram language' }))
            .getAllByRole('radio').every((option) => option.hasAttribute('disabled'))).toBe(true);
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
