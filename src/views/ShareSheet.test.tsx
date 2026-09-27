import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getDiagramFiletypes } from '../kroki/metadata';
import { ShareSheet } from './ShareSheet';

const renderSheet = (language: string, name: string, hasRenderServer = true, madeOnDevice = false) => render(
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
        madeOnDevice={madeOnDevice}
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

    it('offers every format made on this device, with no server and for any language', () => {
        renderSheet('d2', 'D2', false, true);
        expect(offered()).toEqual(['SVG', 'PNG', 'JPEG', 'PDF']);
        expect(screen.getByText('Every format is made on this device. Nothing leaves it.')).toBeInTheDocument();
    });

    it('says the render server makes the formats this device cannot draw', () => {
        renderSheet('mermaid', 'Mermaid', true, false);
        expect(screen.getByText('SVG is made on this device. This diagram has HTML labels or linked files, so the render server makes the other formats.')).toBeInTheDocument();
        renderSheet('graphviz', 'GraphViz', false, false);
        expect(screen.getByText('SVG is made on this device. The other formats need a render server for this diagram.')).toBeInTheDocument();
    });
});
