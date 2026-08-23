import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CodeMirrorEditor from './CodeMirrorEditor';

describe('CodeMirrorEditor', () => {
    it('presents the diagram source as an accessible editor', async () => {
        render(
            <CodeMirrorEditor
                diagramType="plantuml"
                value="@startuml\nAlice -> Bob\n@enduml"
                wrapping
                appearance="light"
                markers={[]}
                onChange={vi.fn()}
            />,
        );

        const editor = await screen.findByRole('textbox', { name: 'Diagram source' });
        expect(editor).toHaveAttribute('contenteditable', 'true');
        expect(editor).toHaveTextContent('@startuml');
    });

    it('updates the visible document when a snapshot or language draft is loaded', async () => {
        const { rerender } = render(
            <CodeMirrorEditor
                diagramType="graphviz"
                value="digraph { a -> b }"
                wrapping
                appearance="dark"
                markers={[]}
                onChange={vi.fn()}
            />,
        );

        rerender(
            <CodeMirrorEditor
                diagramType="graphviz"
                value="digraph { private -> local }"
                wrapping={false}
                appearance="dark"
                markers={[]}
                onChange={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Diagram source' }))
            .toHaveTextContent('private -> local'));
    });
});
