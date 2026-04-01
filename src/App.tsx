import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type * as monacoEditor from 'monaco-editor';
import { getCachedSvgUrl } from './examples/cache';
import { decode } from './kroki/coder';
import {
    buildDiagramState,
    createInitialDiagramState,
    defaultRenderUrl,
    diagramTypes,
    getValidFiletype,
    normalizeRenderUrl,
    parseDiagramUrl,
} from './state';
import type {
    ExampleRecord,
    LayoutMode,
    MobileTab,
} from './types';
import './styles.css';
import PreviewPane from './components/PreviewPane';
import Modal from './components/Modal';
import ExampleImage from './components/ExampleImage';
import EditorDrawer from './components/EditorDrawer';
import LoadingOverlay from './components/LoadingOverlay';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useSvgRender } from './hooks/useSvgRender';
import { useWindowWidth } from './hooks/useWindowWidth';
import { buildExamples, filterExamples } from './utils/examples';
import {
    configureDiagramLanguages,
    getEditorLanguageId,
    getEditorModelPath,
    validateDiagramText,
} from './editor/diagramLanguageRegistry';

const ExcalidrawCanvas = lazy(() => import('./components/ExcalidrawCanvas'));

const layoutModes: LayoutMode[] = ['vertical', 'horizontal', 'preview'];

const monacoOptions = {
    theme: 'vs' as const,
    automaticLayout: true,
    folding: true,
    minimap: { enabled: false },
    fontSize: 14,
    lineHeight: 22,
    padding: { top: 18, bottom: 18 },
    quickSuggestions: { other: true, comments: false, strings: true },
    scrollBeyondLastLine: false,
    snippetSuggestions: 'top' as const,
    suggestOnTriggerCharacters: true,
    smoothScrolling: true,
    tabCompletion: 'on' as const,
    wrappingIndent: 'indent' as const,
};

function App(): JSX.Element {
    const baseUrl = useMemo(() => window.location.origin + window.location.pathname, []);
    const [runtimeRenderUrl, setRuntimeRenderUrl] = useState<string | null>(null);
    const initialRenderUrl = normalizeRenderUrl(runtimeRenderUrl || __KROKI_ENGINE_URL__ || defaultRenderUrl);
    const initialDiagramState = useMemo(() => {
        const state = createInitialDiagramState(baseUrl, window.location.hash);
        return state.renderUrl === initialRenderUrl ? state : buildDiagramState({ ...state, renderUrl: initialRenderUrl });
    }, [baseUrl, initialRenderUrl]);
    const examples = useMemo(() => buildExamples(), []);

    const [diagramType, setDiagramType] = useState(initialDiagramState.diagramType);
    const [filetype, setFiletype] = useState(initialDiagramState.filetype);
    const [renderUrl, setRenderUrl] = useState(initialDiagramState.renderUrl);
    const [editorValue, setEditorValue] = useState(initialDiagramState.diagramText);
    const [previewText, setPreviewText] = useState(initialDiagramState.diagramText);
    const [draftsByDiagramType, setDraftsByDiagramType] = useState<Record<string, string>>({
        [initialDiagramState.diagramType]: initialDiagramState.diagramText,
    });
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('vertical');
    const [wrapEnabled, setWrapEnabled] = useState(true);
    const [editorDrawerOpen, setEditorDrawerOpen] = useState(false);
    const [editorWidth, setEditorWidth] = useState(44);
    const [isDragging, setIsDragging] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab>('code');
    const [examplesMode, setExamplesMode] = useState<'grid' | 'detail' | null>(null);
    const [selectedExampleId, setSelectedExampleId] = useState(0);
    const [examplesSearch, setExamplesSearch] = useState('');
    const [importUrlOpen, setImportUrlOpen] = useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [lastLoadedText, setLastLoadedText] = useState(initialDiagramState.diagramText);
    const [excalidrawViewMode, setExcalidrawViewMode] = useState<'canvas' | 'json'>('canvas');
    const workspaceRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof monacoEditor | null>(null);

    const debouncedEditorValue = useDebouncedValue(editorValue, 500);
    const windowWidth = useWindowWidth();
    const isCompact = windowWidth < 980;
    const editorDirty = editorValue !== lastLoadedText;

    const currentState = useMemo(() => buildDiagramState({
        baseUrl,
        diagramType,
        diagramText: editorValue,
        filetype,
        renderUrl,
    }), [baseUrl, diagramType, editorValue, filetype, renderUrl]);
    const previewState = useMemo(() => buildDiagramState({
        baseUrl,
        diagramType,
        diagramText: previewText,
        filetype,
        renderUrl,
    }), [baseUrl, diagramType, filetype, previewText, renderUrl]);
    const filteredExamples = useMemo(() => filterExamples(examples, examplesSearch), [examples, examplesSearch]);
    const currentTypeExamples = useMemo(() => examples.filter((e) => e.diagramType === diagramType), [examples, diagramType]);
    const selectedExample = examples[selectedExampleId] || examples[0];
    const supportedFiletypes = ['svg', 'png', 'jpeg', 'pdf'];
    const previewSvgUrl = useMemo(
        () => getCachedSvgUrl(previewState.diagramType, previewState.diagramText, previewState.renderUrl) || previewState.svgUrl,
        [previewState.diagramText, previewState.diagramType, previewState.svgUrl, previewState.renderUrl],
    );
    const svg = useSvgRender(diagramType, previewText, previewSvgUrl);
    const editorLanguageId = useMemo(
        () => getEditorLanguageId(diagramType, currentState.language),
        [currentState.language, diagramType],
    );
    const editorModelPath = useMemo(() => getEditorModelPath(diagramType), [diagramType]);
    const localValidationMarkers = useMemo(
        () => validateDiagramText(diagramType, editorValue),
        [diagramType, editorValue],
    );
    const remoteValidationMarkers = useMemo(() => {
        if (!svg.error || svg.local || previewText !== editorValue) {
            return [];
        }

        return [{
            message: svg.error.message,
            startLineNumber: svg.error.line || 1,
            startColumn: svg.error.column || 1,
            endLineNumber: svg.error.line || 1,
            endColumn: (svg.error.column || 1) + 1,
            severity: 'error' as const,
        }];
    }, [editorValue, previewText, svg.error, svg.local]);

    const editorOptions = useMemo(() => ({
        ...monacoOptions,
        wordWrap: wrapEnabled ? 'on' as const : 'off' as const,
    }), [wrapEnabled]);

    useEffect(() => {
        fetch('/config.json')
            .then((res) => res.ok ? res.json() : null)
            .then((config) => {
                if (config?.krokiEngineUrl) {
                    const url = normalizeRenderUrl(config.krokiEngineUrl);
                    setRuntimeRenderUrl(url);
                    setRenderUrl(url);
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!isCompact) {
            setMobileTab('code');
        }
    }, [isCompact]);

    useEffect(() => {
        if (debouncedEditorValue === editorValue) {
            setPreviewText(debouncedEditorValue);
        }
    }, [debouncedEditorValue, editorValue]);

    useEffect(() => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;

        if (!editor || !monaco) {
            return;
        }

        const model = editor.getModel();
        if (!model) {
            return;
        }

        const toMonacoMarker = (
            marker: {
                message: string;
                startLineNumber: number;
                startColumn: number;
                endLineNumber: number;
                endColumn: number;
                severity: 'error' | 'warning';
            },
        ): monacoEditor.editor.IMarkerData => ({
            ...marker,
            severity: marker.severity === 'warning'
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Error,
        });

        monaco.editor.setModelMarkers(model, 'neolesk-local-validation', localValidationMarkers.map(toMonacoMarker));
        monaco.editor.setModelMarkers(model, 'neolesk-remote-validation', remoteValidationMarkers.map(toMonacoMarker));
    }, [localValidationMarkers, remoteValidationMarkers]);

    useEffect(() => {
        const nextHash = `#${previewState.diagramHash}`;
        if (window.location.hash !== nextHash) {
            window.history.replaceState(null, '', nextHash);
        }
    }, [previewState.diagramHash]);

    useEffect(() => {
        const handleHashChange = () => {
            const parsed = parseDiagramUrl(window.location.hash);
            if (!parsed) {
                return;
            }

            setDiagramType(parsed.diagramType);
            setFiletype(parsed.filetype);
            setEditorValue(parsed.diagramText);
            setPreviewText(parsed.diagramText);
            setLastLoadedText(parsed.diagramText);
            updateDiagramDraft(parsed.diagramType, parsed.diagramText);
        };

        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    useEffect(() => {
        if (!isDragging || !workspaceRef.current || layoutMode !== 'vertical') {
            return;
        }

        const handleMouseMove = (event: MouseEvent) => {
            if (!workspaceRef.current) {
                return;
            }

            const rect = workspaceRef.current.getBoundingClientRect();
            const width = ((event.clientX - rect.left) / rect.width) * 100;
            setEditorWidth(Math.min(68, Math.max(30, width)));
        };

        const handleMouseUp = () => setIsDragging(false);

        document.body.classList.add('workspace-resizing');
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.body.classList.remove('workspace-resizing');
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, layoutMode]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setExamplesMode(null);
                setImportUrlOpen(false);
                setEditorDrawerOpen(false);
            }

            if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                if (event.key === 'x') {
                    setExamplesMode('grid');
                    setExamplesSearch('');
                }

                if (event.key === 'i') {
                    setImportUrlOpen(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const isExcalidraw = diagramType === 'excalidraw';
    const showEditorPane = isExcalidraw
        ? (excalidrawViewMode === 'json' && (!isCompact || mobileTab === 'code'))
        : (!isCompact ? layoutMode !== 'preview' : mobileTab === 'code');
    const showPreviewPane = isExcalidraw
        ? false
        : (!isCompact ? true : mobileTab === 'preview');

    const updateDiagramDraft = (nextDiagramType: string, nextText: string) => {
        setDraftsByDiagramType((current) => (
            current[nextDiagramType] === nextText
                ? current
                : { ...current, [nextDiagramType]: nextText }
        ));
    };

    const handleDiagramTypeChange = (nextDiagramType: string) => {
        const nextText = draftsByDiagramType[nextDiagramType] || decode(diagramTypes[nextDiagramType].example);
        setDiagramType(nextDiagramType);
        setFiletype(getValidFiletype(nextDiagramType, currentState.filetype));
        setEditorValue(nextText);
        setPreviewText(nextText);
        setLastLoadedText(nextText);
        updateDiagramDraft(nextDiagramType, nextText);
    };

    const handleImportUrl = () => {
        const parsed = parseDiagramUrl(importUrl);
        if (!parsed) {
            return;
        }

        setDiagramType(parsed.diagramType);
        setFiletype(parsed.filetype);
        setEditorValue(parsed.diagramText);
        setPreviewText(parsed.diagramText);
        setLastLoadedText(parsed.diagramText);
        updateDiagramDraft(parsed.diagramType, parsed.diagramText);
        setImportUrlOpen(false);
        setImportUrl('');
    };

    const handleExampleImport = (example: ExampleRecord) => {
        setDiagramType(example.diagramType);
        setFiletype(getValidFiletype(example.diagramType, filetype));
        const exampleText = decode(example.example);
        setEditorValue(exampleText);
        setPreviewText(exampleText);
        setLastLoadedText(exampleText);
        updateDiagramDraft(example.diagramType, exampleText);
        setExamplesMode(null);
    };

    const handleEditorChange = useCallback((value: string | undefined) => {
        const nextValue = value || '';
        setEditorValue(nextValue);
        setDraftsByDiagramType((current) => (
            current[diagramType] === nextValue
                ? current
                : { ...current, [diagramType]: nextValue }
        ));
    }, [diagramType]);

    const handleRenderUrlChange = useCallback((value: string) => {
        setRenderUrl(normalizeRenderUrl(value));
    }, []);

    const handleEditorMount = useCallback((
        editor: monacoEditor.editor.IStandaloneCodeEditor,
        monaco: typeof monacoEditor,
    ) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
    }, []);

    return (
        <div className="App">
            <header className="AppToolbar">
                <div className="AppToolbarBrand">
                    <span className="AppToolbarLogo">Neolesk</span>
                </div>
                <div className="AppToolbarControls">
                    <label className="AppSelectField DiagramTypeField">
                        <span className="AppSelectFieldLabel">Diagram type</span>
                        <select
                            className="AppSelectControl DiagramTypeSelect"
                            value={diagramType}
                            onChange={(event) => handleDiagramTypeChange(event.target.value)}
                        >
                            {Object.entries(diagramTypes).map(([value, info]) => (
                                <option key={value} value={value}>
                                    {info.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="AppToolbarActions">
                    {!isCompact && !isExcalidraw ? (
                        <div className="SplitPresetGroup" aria-label="Preview layout modes">
                            {layoutModes.map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`SplitPresetButton${layoutMode === mode ? ' active' : ''}`}
                                    onClick={() => setLayoutMode(mode)}
                                >
                                    <span className={`SplitPresetIcon SplitPresetIcon${mode[0].toUpperCase()}${mode.slice(1)}`}>
                                        {mode === 'vertical' ? (
                                            <>
                                                <span className="SplitPresetIconPane SplitPresetIconPaneNarrow" />
                                                <span className="SplitPresetIconPane SplitPresetIconPaneWide" />
                                            </>
                                        ) : null}
                                        {mode === 'horizontal' ? (
                                            <>
                                                <span className="SplitPresetIconPane SplitPresetIconPaneTop" />
                                                <span className="SplitPresetIconPane SplitPresetIconPaneBottom" />
                                            </>
                                        ) : null}
                                        {mode === 'preview' ? <span className="SplitPresetIconPane SplitPresetIconPaneFull" /> : null}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className="AppToolbarButton AppToolbarButtonIconOnlyMobile"
                        onClick={() => { setExamplesMode('grid'); setExamplesSearch(''); }}
                        aria-label="Examples"
                        title="Examples"
                    >
                        <span className="AppToolbarButtonIcon" aria-hidden="true">
                            <svg viewBox="0 0 20 20" focusable="false">
                                <path d="M4 4.5h5l1.1 1.5H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4A1.5 1.5 0 0 1 2.5 14.5V6A1.5 1.5 0 0 1 4 4.5Z" />
                            </svg>
                        </span>
                        <span className="AppToolbarButtonLabel">Examples</span>
                    </button>
                    <button
                        type="button"
                        className="AppToolbarButton AppToolbarButtonIconOnlyMobile"
                        onClick={() => setImportUrlOpen(true)}
                        aria-label="Import"
                        title="Import"
                    >
                        <span className="AppToolbarButtonIcon" aria-hidden="true">
                            <svg viewBox="0 0 20 20" focusable="false">
                                <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h3.4l1.2 1.5h6.4A1.5 1.5 0 0 1 17 7v7.5A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-9Z" />
                                <path d="M10 8.1a.65.65 0 0 1 .65.65v2.1h2.1a.65.65 0 1 1 0 1.3h-2.1v2.1a.65.65 0 1 1-1.3 0v-2.1h-2.1a.65.65 0 1 1 0-1.3h2.1v-2.1A.65.65 0 0 1 10 8.1Z" />
                            </svg>
                        </span>
                        <span className="AppToolbarButtonLabel">Import</span>
                    </button>
                </div>
            </header>

            {isCompact ? (
                <div className="WorkspaceMobileTabs">
                    {isExcalidraw ? (
                        <div className="WorkspaceMobileTabGroup">
                            <button type="button" className={`WorkspaceMobileTab${excalidrawViewMode === 'canvas' ? ' active' : ''}`} onClick={() => setExcalidrawViewMode('canvas')}>
                                Canvas
                            </button>
                            <button type="button" className={`WorkspaceMobileTab${excalidrawViewMode === 'json' ? ' active' : ''}`} onClick={() => setExcalidrawViewMode('json')}>
                                JSON
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="WorkspaceMobileTabGroup">
                                <button type="button" className={`WorkspaceMobileTab${mobileTab === 'code' ? ' active' : ''}`} onClick={() => setMobileTab('code')}>
                                    Code
                                </button>
                                <button type="button" className={`WorkspaceMobileTab${mobileTab === 'preview' ? ' active' : ''}`} onClick={() => setMobileTab('preview')}>
                                    Preview
                                </button>
                            </div>
                            <button
                                type="button"
                                className={`EditorWrapButton EditorWrapButtonCompact${wrapEnabled ? ' active' : ''}`}
                                onClick={() => setWrapEnabled((current) => !current)}
                            >
                                Wrap
                            </button>
                        </>
                    )}
                </div>
            ) : null}

            <main className="MainPanel">
                {isExcalidraw ? (
                    <div className="Workspace WorkspaceModePreview" ref={workspaceRef}>
                        {excalidrawViewMode === 'canvas' ? (
                            <section className="WorkspacePanel WorkspacePanelExcalidraw">
                                {!isCompact ? (
                                    <div className="WorkspacePanelBar">
                                        <span className="WorkspacePanelTitle">Canvas</span>
                                        <div className="ExcalidrawBarActions">
                                            <button
                                                type="button"
                                                className="EditorWrapButton"
                                                onClick={() => setExcalidrawViewMode('json')}
                                            >
                                                JSON
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                                <div className="WorkspacePanelBody">
                                    <Suspense fallback={<LoadingOverlay message="Loading Excalidraw" detail="~2 MB" />}>
                                        <ExcalidrawCanvas
                                            value={editorValue}
                                            onChange={handleEditorChange}
                                            isCompact={isCompact}
                                            viewMode={excalidrawViewMode}
                                        />
                                    </Suspense>
                                </div>
                            </section>
                        ) : (
                            <section className="WorkspacePanel WorkspacePanelEditor">
                                {!isCompact ? (
                                    <div className="WorkspacePanelBar">
                                        <span className="WorkspacePanelTitle">JSON</span>
                                        <div className="ExcalidrawBarActions">
                                            <button
                                                type="button"
                                                className="EditorWrapButton"
                                                onClick={() => setExcalidrawViewMode('canvas')}
                                            >
                                                Canvas
                                            </button>
                                            <button
                                                type="button"
                                                className={`EditorWrapButton${wrapEnabled ? ' active' : ''}`}
                                                onClick={() => setWrapEnabled((current) => !current)}
                                            >
                                                Wrap
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                                <div className="WorkspacePanelBody">
                                    <div className="Editor">
                                        <MonacoEditor
                                            className="MonacoEditor"
                                            beforeMount={configureDiagramLanguages}
                                            onMount={handleEditorMount}
                                            language={editorLanguageId}
                                            path={editorModelPath}
                                            value={editorValue}
                                            onChange={handleEditorChange}
                                            height="100%"
                                            options={editorOptions}
                                        />
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>
                ) : (
                    <div
                        className={`Workspace WorkspaceMode${layoutMode[0].toUpperCase()}${layoutMode.slice(1)}`}
                        ref={workspaceRef}
                        style={{ ['--editor-panel-width' as string]: `${editorWidth}%` }}
                    >
                        <section className={`WorkspacePanel WorkspacePanelEditor${showEditorPane ? '' : ' compactHidden'}`}>
                            {!isCompact ? (
                                <div className="WorkspacePanelBar">
                                    <span className="WorkspacePanelTitle">Code</span>
                                    <button
                                        type="button"
                                        className={`EditorWrapButton${wrapEnabled ? ' active' : ''}`}
                                        onClick={() => setWrapEnabled((current) => !current)}
                                    >
                                        Wrap
                                    </button>
                                </div>
                            ) : null}
                            <div className="WorkspacePanelBody">
                                <div className="Editor">
                                    <MonacoEditor
                                        className="MonacoEditor"
                                        beforeMount={configureDiagramLanguages}
                                        onMount={handleEditorMount}
                                        language={editorLanguageId}
                                        path={editorModelPath}
                                        value={editorValue}
                                        onChange={handleEditorChange}
                                        height="100%"
                                        options={editorOptions}
                                    />
                                </div>
                            </div>
                            <EditorDrawer
                                diagramType={diagramType}
                                examples={currentTypeExamples}
                                editorDirty={editorDirty}
                                open={editorDrawerOpen}
                                onToggle={() => setEditorDrawerOpen((v) => !v)}
                                onExampleImport={handleExampleImport}
                            />
                        </section>

                        {!isCompact && layoutMode === 'vertical' && showEditorPane ? (
                            <button
                                type="button"
                                aria-label="Resize panels"
                                className="WorkspaceDivider"
                                onMouseDown={() => setIsDragging(true)}
                                onDoubleClick={() => setEditorWidth(44)}
                            />
                        ) : null}

                        <section className={`WorkspacePanel WorkspacePanelPreview${showPreviewPane ? '' : ' compactHidden'}${!isCompact && layoutMode === 'preview' ? ' previewOnly' : ''}`}>
                            <div className="WorkspacePanelBody">
                                <PreviewPane
                                    svg={svg}
                                    diagramType={diagramType}
                                    filetypes={supportedFiletypes}
                                    previewState={previewState}
                                    editorValue={editorValue}
                                    renderUrl={renderUrl}
                                    defaultRenderUrl={defaultRenderUrl}
                                    onRenderUrlChange={handleRenderUrlChange}
                                />
                            </div>
                        </section>
                    </div>
                )}
            </main>

            <Modal
                open={examplesMode === 'grid'}
                title="Examples"
                onClose={() => setExamplesMode(null)}
                headerExtras={(
                    <input
                        className="ModalSearchInput"
                        placeholder="Search examples"
                        value={examplesSearch}
                        onChange={(event) => setExamplesSearch(event.target.value)}
                    />
                )}
            >
                <div className="ExamplesGrid">
                    {filteredExamples.map((example) => (
                        <article key={example.id} className="ExampleCard">
                            <div className="ExampleCardPreview">
                                <ExampleImage alt={example.title} example={example} />
                            </div>
                            <div className="ExampleCardBody">
                                <h3>{example.title}</h3>
                                <p>{example.description}</p>
                            </div>
                            <div className="ExampleCardActions">
                                <button
                                    type="button"
                                    className="ModalButton ModalButtonPrimary"
                                    onClick={() => {
                                        setSelectedExampleId(example.id);
                                        setExamplesMode('detail');
                                    }}
                                >
                                    View
                                </button>
                                <button type="button" className="ModalButton" onClick={() => handleExampleImport(example)}>
                                    Import
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            </Modal>

            <Modal
                open={examplesMode === 'detail'}
                title={selectedExample.title}
                onClose={() => setExamplesMode(null)}
                actions={(
                    <>
                        <button
                            type="button"
                            className="ModalButton"
                            onClick={() => setSelectedExampleId((current) => (current - 1 + examples.length) % examples.length)}
                        >
                            Prev
                        </button>
                        <button
                            type="button"
                            className="ModalButton"
                            onClick={() => setSelectedExampleId((current) => (current + 1) % examples.length)}
                        >
                            Next
                        </button>
                        <button
                            type="button"
                            className="ModalButton ModalButtonPrimary"
                            onClick={() => handleExampleImport(selectedExample)}
                        >
                            Import
                        </button>
                    </>
                )}
            >
                <div className="ExampleDetail">
                    <div className="ExampleDetailMeta">
                        <p>{selectedExample.description}</p>
                        {selectedExample.doc ? (
                            <a href={selectedExample.doc} target="_blank" rel="noreferrer">
                                Documentation
                            </a>
                        ) : null}
                    </div>
                    <div className="ExampleDetailPreview">
                        <ExampleImage alt={selectedExample.title} example={selectedExample} />
                    </div>
                    <pre className="ExampleDetailCode code">{decode(selectedExample.example)}</pre>
                </div>
            </Modal>

            <Modal
                open={importUrlOpen}
                title="Import Diagram URL"
                onClose={() => setImportUrlOpen(false)}
                actions={(
                    <button type="button" className="ModalButton ModalButtonPrimary" onClick={handleImportUrl}>
                        Import
                    </button>
                )}
            >
                <div className="ImportForm">
                    <input
                        className="ModalInput code"
                        placeholder="diagramType/svg/encoded"
                        value={importUrl}
                        onChange={(event) => setImportUrl(event.target.value)}
                    />
                </div>
            </Modal>
        </div>
    );
}

export default App;
