import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { EphemeralStore, LoroDoc, LoroText, UndoManager } from 'loro-crdt/bundler';
import type { Appearance } from '../preferences/preferences';
import { getCodeMirrorSupport, toCodeMirrorDiagnostics, validateDiagramText } from './codeMirrorLanguage';
import type { DiagramValidationMarker } from './languages/types';

export interface CollaborationBinding {
    doc: LoroDoc;
    getText: (doc: LoroDoc) => LoroText;
    ephemeral: EphemeralStore;
    undoManager: UndoManager;
    user: {
        name: string;
        colorClassName: string;
    };
    replaceDocument?: (snapshot: { language: string; source: string }, message: string) => void;
}

interface CodeMirrorEditorProps {
    diagramType: string;
    value: string;
    wrapping: boolean;
    appearance: Appearance;
    markers: DiagramValidationMarker[];
    onChange: (value: string) => void;
    editable?: boolean;
    scrollTop?: number;
    scrollLeft?: number;
    onScroll?: (position: { scrollTop: number; scrollLeft: number }) => void;
    collaboration?: CollaborationBinding | null;
}

const externalUpdate = Annotation.define<boolean>();

const editorTheme = (appearance: Appearance): Extension => EditorView.theme({
    '&': {
        height: '100%',
        color: 'var(--label)',
        backgroundColor: 'transparent',
        fontSize: 'var(--editor-font-size, 14px)',
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
        // Line numbers are text, so they take the secondary label colour for contrast.
        color: 'var(--secondary-label)',
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

/**
 * Syntax colours as CSS tokens, so dark mode and Increase Contrast apply. The
 * basicSetup default style is light-only and falls below 2:1 on a dark editor.
 */
const syntaxColours = syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.modifier, tags.bool, tags.atom], color: 'var(--syntax-keyword)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--syntax-number)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName, tags.heading], color: 'var(--syntax-type)' },
    { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: 'var(--syntax-property)' },
    { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: 'var(--syntax-meta)' },
    { tag: [tags.variableName, tags.definition(tags.variableName), tags.function(tags.variableName)], color: 'var(--label)' },
    { tag: tags.invalid, color: 'var(--red-text)' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.link, color: 'var(--tint-text)', textDecoration: 'underline' },
]));

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
    scrollTop = 0,
    scrollLeft = 0,
    onScroll,
    collaboration,
    editable = true,
}: CodeMirrorEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onScrollRef = useRef(onScroll);
    const valueRef = useRef(value);
    const diagramTypeRef = useRef(diagramType);
    const compartmentsRef = useRef({
        language: new Compartment(),
        wrapping: new Compartment(),
        appearance: new Compartment(),
        validation: new Compartment(),
        collaboration: new Compartment(),
        editable: new Compartment(),
    });
    onChangeRef.current = onChange;
    onScrollRef.current = onScroll;
    valueRef.current = value;
    diagramTypeRef.current = diagramType;

    useEffect(() => {
        if (!hostRef.current) return undefined;
        const compartments = compartmentsRef.current;
        const support = getCodeMirrorSupport(diagramType);
        const state = EditorState.create({
            doc: value,
            extensions: [
                basicSetup,
                syntaxColours,
                compartments.language.of(support.extensions),
                compartments.wrapping.of(wrapping ? EditorView.lineWrapping : []),
                compartments.appearance.of(editorTheme(appearance)),
                compartments.validation.of(validationExtension(diagramType, markers)),
                compartments.collaboration.of([]),
                compartments.editable.of(EditorView.editable.of(editable)),
                EditorView.contentAttributes.of({
                    'aria-label': 'Diagram source',
                    'aria-multiline': 'true',
                    spellcheck: 'false',
                    // The iOS keyboard would otherwise capitalise and "correct" diagram source.
                    autocapitalize: 'off',
                    autocorrect: 'off',
                    // WebKit reports a contenteditable as unfocusable without an explicit tab index.
                    tabindex: '0',
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
        const reportScroll = () => onScrollRef.current?.({
            scrollTop: view.scrollDOM.scrollTop,
            scrollLeft: view.scrollDOM.scrollLeft,
        });
        view.scrollDOM.addEventListener('scroll', reportScroll, { passive: true });
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
        return () => {
            view.scrollDOM.removeEventListener('scroll', reportScroll);
            view.destroy();
            viewRef.current = null;
        };
        // The editor instance is intentionally created once. Compartments handle prop changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const scrollDOM = viewRef.current?.scrollDOM;
        if (!scrollDOM) return;
        if (Math.abs(scrollDOM.scrollTop - scrollTop) > 1 || Math.abs(scrollDOM.scrollLeft - scrollLeft) > 1) {
            scrollDOM.scrollTop = scrollTop;
            scrollDOM.scrollLeft = scrollLeft;
        }
    }, [scrollLeft, scrollTop]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        if (collaboration) {
            collaboration.replaceDocument?.(
                { language: diagramType, source: value },
                'Replaced diagram source',
            );
            return;
        }
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
        viewRef.current?.dispatch({
            effects: compartmentsRef.current.editable.reconfigure(EditorView.editable.of(editable)),
        });
    }, [editable]);

    useEffect(() => {
        let cancelled = false;
        const view = viewRef.current;
        if (!view) return undefined;

        if (!collaboration) {
            view.dispatch({ effects: compartmentsRef.current.collaboration.reconfigure([]) });
            hostRef.current?.removeAttribute('data-collaboration');
            return undefined;
        }

        let ready = false;
        let pending: { snapshot: { language: string; source: string }; message: string } | null = null;
        const replaceDocument = (snapshot: { language: string; source: string }, message: string) => {
            if (!ready) {
                pending = { snapshot, message };
                return;
            }
            const currentView = viewRef.current;
            if (cancelled || currentView !== view) return;
            const language = collaboration.doc.getText('language');
            const languageChanged = language.toString() !== snapshot.language;
            const currentSource = currentView.state.doc.toString();
            if (!languageChanged && currentSource === snapshot.source) return;
            if (languageChanged) language.update(snapshot.language);
            collaboration.doc.setNextCommitOptions({ origin: 'human', message });
            if (currentSource === snapshot.source) {
                collaboration.doc.commit();
                return;
            }
            view.dispatch({
                changes: { from: 0, to: currentSource.length, insert: snapshot.source },
            });
        };
        collaboration.replaceDocument = replaceDocument;

        import('loro-codemirror').then(async ({ LoroExtensions }) => {
            if (cancelled || viewRef.current !== view) return;
            view.dispatch({
                effects: compartmentsRef.current.collaboration.reconfigure(LoroExtensions(
                    collaboration.doc,
                    { ephemeral: collaboration.ephemeral, user: collaboration.user },
                    collaboration.undoManager,
                    collaboration.getText,
                )),
            });
            // The adapter initializes from Loro in a microtask. Apply the latest
            // React snapshot only after that dispatch so exact offsets stay valid.
            await Promise.resolve();
            if (cancelled || viewRef.current !== view) return;
            // loro-codemirror suppresses the transaction after its initialization,
            // including when no initialization change was necessary. Consume that
            // guard with an empty transaction before a real local replacement.
            view.dispatch({ annotations: externalUpdate.of(true) });
            ready = true;
            hostRef.current?.setAttribute('data-collaboration', 'ready');
            const requested = pending || {
                snapshot: { language: diagramTypeRef.current, source: valueRef.current },
                message: 'Synchronized diagram source',
            };
            pending = null;
            replaceDocument(requested.snapshot, requested.message);
        });

        return () => {
            cancelled = true;
            hostRef.current?.removeAttribute('data-collaboration');
            if (collaboration.replaceDocument === replaceDocument) delete collaboration.replaceDocument;
        };
    }, [collaboration]);

    return <div className="CodeMirrorEditor" ref={hostRef} />;
}

export default CodeMirrorEditor;
