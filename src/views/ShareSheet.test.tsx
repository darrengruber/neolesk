import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getDiagramFiletypes } from '../kroki/metadata';
import { ShareSheet } from './ShareSheet';

const renderSheet = (language: string, name: string, hasRenderServer = true) => render(
    <ShareSheet
        open
        onClose={vi.fn()}
        canShareLink={false}
        onCopySnapshot={vi.fn()}
        onShareSnapshot={vi.fn()}
        session={{
            available: false,
            active: false,
            presence: 'offline',
            agentPresence: 'offline',
            agentActivity: null,
            onStart: vi.fn(),
            onCopyAgentUrl: vi.fn(),
            onCopySessionLink: vi.fn(),
        }}
        hasRenderServer={hasRenderServer}
        language={{ name, formats: getDiagramFiletypes(language) }}
        hasDiagram
        onExport={vi.fn()}
        onPrint={vi.fn()}
    />,
);

const offered = () => {
    const sheet = screen.getByRole('dialog', { hidden: true });
    return ['SVG', 'PNG', 'JPEG', 'PDF'].filter((format) => within(sheet)
        .getByRole('button', { name: new RegExp(`^${format}`), hidden: true })
        .hasAttribute('disabled') === false);
};

describe('Share and Export sheet', () => {
    // Each list was checked against the render server: it answers any other
    // format with "Unsupported output format".
    it.each([
        ['d2', 'D2', ['SVG']],
        ['mermaid', 'Mermaid', ['SVG', 'PNG']],
        ['diagramsnet', 'diagrams.net', ['SVG', 'PNG']],
        ['plantuml', 'PlantUML', ['SVG', 'PNG', 'PDF']],
        ['umlet', 'UMlet', ['SVG', 'PNG', 'JPEG']],
        ['graphviz', 'GraphViz', ['SVG', 'PNG', 'JPEG', 'PDF']],
    ])('offers the %s formats that the metadata lists', (language, name, formats) => {
        renderSheet(language, name);
        expect(offered()).toEqual(formats);
        expect(offered()).toEqual(getDiagramFiletypes(language)
            .map((format) => format.toUpperCase())
            .sort((a, b) => ['SVG', 'PNG', 'JPEG', 'PDF'].indexOf(a) - ['SVG', 'PNG', 'JPEG', 'PDF'].indexOf(b)));
    });

    it('says why a format is not available for the language', () => {
        renderSheet('d2', 'D2');
        const sheet = screen.getByRole('dialog', { hidden: true });
        expect(within(sheet).getAllByText('Not available for D2')).toHaveLength(3);
    });

    it('keeps the render server note when there is no consent', () => {
        renderSheet('graphviz', 'GraphViz', false);
        expect(offered()).toEqual(['SVG']);
        expect(within(screen.getByRole('dialog', { hidden: true })).getAllByText('Needs a render server')).toHaveLength(3);
    });
});
