import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EphemeralStore, LoroDoc, UndoManager } from 'loro-crdt/bundler';
import CodeMirrorEditor, { type CollaborationBinding } from './CodeMirrorEditor';

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

    const collaborativeEditor = (source: string) => {
        const doc = new LoroDoc();
        doc.getText('source').update(source);
        doc.commit();
        const collaboration = {
            doc,
            getText: (value: LoroDoc) => value.getText('source'),
            ephemeral: new EphemeralStore(),
            undoManager: new UndoManager(doc, {}),
            user: { name: 'Human', colorClassName: 'human' },
        } as CollaborationBinding;
        const element = (value: string) => (
            <CodeMirrorEditor
                diagramType="d2"
                value={value}
                wrapping
                appearance="light"
                markers={[]}
                onChange={vi.fn()}
                collaboration={collaboration}
            />
        );
        return { doc, collaboration, element };
    };

    it('applies an explicit whole-document replacement through the collaborative binding', async () => {
        const { doc, collaboration, element } = collaborativeEditor('a -> b');
        render(element('a -> b'));
        await waitFor(() => expect(document.querySelector('.CodeMirrorEditor'))
            .toHaveAttribute('data-collaboration', 'ready'));

        collaboration.replaceDocument?.({ language: 'd2', source: 'replacement -> diagram' }, 'Loaded an example');

        await waitFor(() => expect(doc.getText('source').toString()).toBe('replacement -> diagram'));
        expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveTextContent('replacement -> diagram');
    });

    // Regression: in a live session React's value only mirrors the shared
    // document. A render that carries an older value (a burst of agent writes
    // arrives faster than React renders) must not write that older text back
    // into the session as a human edit.
    it('never writes a stale value prop back into the shared document', async () => {
        const { doc, element } = collaborativeEditor('digraph { a }');
        const { rerender } = render(element('digraph { a }'));
        await waitFor(() => expect(document.querySelector('.CodeMirrorEditor'))
            .toHaveAttribute('data-collaboration', 'ready'));
        let localEdits = 0;
        const unsubscribe = doc.subscribeLocalUpdates(() => { localEdits += 1; });

        // Two agent writes arrive from another peer.
        const agent = LoroDoc.fromSnapshot(doc.export({ mode: 'snapshot' }));
        for (const next of ['digraph { n0 }', 'digraph { n1 }']) {
            agent.getText('source').update(next);
            agent.commit();
            doc.import(agent.export({ mode: 'update', from: doc.oplogVersion() }));
        }
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveTextContent('digraph { n1 }'));

        // React then renders with the value from the first write.
        rerender(element('digraph { n0 }'));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(doc.getText('source').toString()).toBe('digraph { n1 }');
        expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveTextContent('digraph { n1 }');
        expect(localEdits).toBe(0);
        unsubscribe();
    });
});
