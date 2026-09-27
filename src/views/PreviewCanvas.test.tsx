import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DiagramRenderState } from '../hooks/useDiagramRender';
import { PreviewCanvas } from './PreviewCanvas';

const failedAfterAGoodRender: DiagramRenderState = {
    svgText: '<svg/>',
    blobUrl: 'blob:last-good',
    dimensions: { width: 200, height: 100 },
    loading: false,
    error: new Error('syntax error (line 3)'),
    consentRequired: false,
    diagnostics: [],
    provenance: null,
};

const canvas = (renderState: DiagramRenderState, agentDrawing: boolean) => render(
    <PreviewCanvas
        layout="wide"
        previewRef={createRef<HTMLElement>()}
        renderState={renderState}
        zoom={1}
        emptySource={false}
        agentDrawing={agentDrawing}
        onZoomChange={vi.fn()}
        onScrollChange={vi.fn()}
        onAllowRemote={vi.fn()}
        renderServerHost="diagrams.example"
    />,
);

describe('PreviewCanvas', () => {
    it('keeps the last valid diagram while the agent is still drawing', () => {
        canvas(failedAfterAGoodRender, true);
        expect(screen.getByRole('img', { name: 'Rendered diagram' })).toHaveAttribute('src', 'blob:last-good');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Agent is still drawing');
    });

    it('shows a drawing state, not an error, before the agent has a valid diagram', () => {
        canvas({ ...failedAfterAGoodRender, svgText: null, blobUrl: null, dimensions: null }, true);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText('Agent is still drawing')).toBeInTheDocument();
    });

    it('shows the error when the person made the change', () => {
        canvas(failedAfterAGoodRender, false);
        expect(screen.getByRole('alert')).toHaveTextContent('syntax error (line 3)');
        expect(screen.queryByRole('img', { name: 'Rendered diagram' })).not.toBeInTheDocument();
    });
});
