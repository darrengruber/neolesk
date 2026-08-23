import { fireEvent, render, screen } from '@testing-library/react';
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
});
