import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { linter } from '@codemirror/lint';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { EphemeralStore, LoroDoc, UndoManager } from 'loro-crdt';
import type { Appearance } from '../preferences/preferences';
import { getCodeMirrorSupport, toCodeMirrorDiagnostics, validateDiagramText } from './codeMirrorLanguage';
import type { DiagramValidationMarker } from './languages/types';

export interface CollaborationBinding {
    doc: LoroDoc;
    ephemeral: EphemeralStore;
    undoManager: UndoManager;
    user: {
        name: string;
        colorClassName: string;
    };
}

interface CodeMirrorEditorProps {
    diagramType: string;
    value: string;
    wrapping: boolean;
    appearance: Appearance;
    markers: DiagramValidationMarker[];
    onChange: (value: string) => void;
    collaboration?: CollaborationBinding | null;
}

const externalUpdate = Annotation.define<boolean>();

const editorTheme = (appearance: Appearance): Extension => EditorView.theme({
    '&': {
        height: '100%',
        color: 'var(--label)',
        backgroundColor: 'transparent',
        fontSize: '14px',
    },
    '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.55',
        padding: '12px 0 28px',
    },
    '.cm-content': {
        caretColor: 'var(--tint)',
        padding: '0 16px',
    },
    '.cm-gutters': {
        color: 'var(--tertiary-label)',
        backgroundColor: 'transparent',
        borderRight: '1px solid var(--separator)',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'var(--selection-fill)',
    },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection)',
    },
}, { dark: appearance === 'dark' });

const validationExtension = (
    diagramType: string,
    remoteMarkers: DiagramValidationMarker[],
): Extension => linter((view) => toCodeMirrorDiagnostics(
    view.state,
    [...validateDiagramText(diagramType, view.state.doc.toString()), ...remoteMarkers],
));

function CodeMirrorEditor({
    diagramType,
    value,
    wrapping,
    appearance,
    markers,
    onChange,
    collaboration,
}: CodeMirrorEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const compartmentsRef = useRef({
        language: new Compartment(),
        wrapping: new Compartment(),
        appearance: new Compartment(),
        validation: new Compartment(),
        collaboration: new Compartment(),
    });
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!hostRef.current) return undefined;
        const compartments = compartmentsRef.current;
        const support = getCodeMirrorSupport(diagramType);
        const state = EditorState.create({
            doc: value,
            extensions: [
                basicSetup,
                compartments.language.of(support.extensions),
                compartments.wrapping.of(wrapping ? EditorView.lineWrapping : []),
                compartments.appearance.of(editorTheme(appearance)),
                compartments.validation.of(validationExtension(diagramType, markers)),
                compartments.collaboration.of([]),
                EditorView.contentAttributes.of({
                    'aria-label': 'Diagram source',
                    'aria-multiline': 'true',
                    spellcheck: 'false',
                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && !update.transactions.some((transaction) => (
                        transaction.annotation(externalUpdate)
                    ))) {
                        onChangeRef.current(update.state.doc.toString());
                    }
                }),
            ],
        });
        const view = new EditorView({ state, parent: hostRef.current });
        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // The editor instance is intentionally created once. Compartments handle prop changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const view = viewRef.current;
        if (!view || collaboration) return;
        const current = view.state.doc.toString();
        if (current === value) return;
        view.dispatch({
            changes: { from: 0, to: current.length, insert: value },
            annotations: externalUpdate.of(true),
        });
    }, [collaboration, value]);

    useEffect(() => {
        viewRef.current?.dispatch({
            effects: compartmentsRef.current.language.reconfigure(getCodeMirrorSupport(diagramType).extensions),
        });
    }, [diagramType]);

    useEffect(() => {
        viewRef.current?.dispatch({
            effects: compartmentsRef.current.wrapping.reconfigure(wrapping ? EditorView.lineWrapping : []),
        });
    }, [wrapping]);

    useEffect(() => {
        viewRef.current?.dispatch({
            effects: compartmentsRef.current.appearance.reconfigure(editorTheme(appearance)),
        });
    }, [appearance]);

    useEffect(() => {
        viewRef.current?.dispatch({
            effects: compartmentsRef.current.validation.reconfigure(validationExtension(diagramType, markers)),
        });
    }, [diagramType, markers]);

    useEffect(() => {
        let cancelled = false;
        const view = viewRef.current;
        if (!view) return undefined;

        if (!collaboration) {
            view.dispatch({ effects: compartmentsRef.current.collaboration.reconfigure([]) });
            return undefined;
        }

        import('loro-codemirror').then(({ LoroExtensions }) => {
            if (cancelled || viewRef.current !== view) return;
            view.dispatch({
                effects: compartmentsRef.current.collaboration.reconfigure(LoroExtensions(
                    collaboration.doc,
                    { ephemeral: collaboration.ephemeral, user: collaboration.user },
                    collaboration.undoManager,
                )),
            });
        });

        return () => { cancelled = true; };
    }, [collaboration]);

    return <div className="CodeMirrorEditor" ref={hostRef} />;
}

export default CodeMirrorEditor;
