import React, { useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import exampleData from './examples';
import { getExampleUrl } from './examples/usecache';
import { decode } from './kroki/coder';
import {
    buildDiagramState,
    changeDiagramType,
    createInitialDiagramState,
    defaultRenderUrl,
    diagramTypes,
    getValidFiletype,
    normalizeRenderUrl,
    parseDiagramUrl,
} from './app/state';
import type {
    CopyScope,
    DiagramState,
    ExampleDefinition,
    ExampleRecord,
    LayoutMode,
    MobileTab,
} from './types';
import './styles.css';
import OutputFormatGroup from './components/OutputFormatGroup';

const imageFiletypes = new Set(['svg', 'png', 'jpeg', 'jpg', 'gif', 'webp']);
const layoutModes: LayoutMode[] = ['vertical', 'horizontal', 'preview'];
const copyScopes: CopyScope[] = ['image', 'edit', 'markdown', 'markdownsource'];

const useDebouncedValue = <T,>(value: T, delay: number): T => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => window.clearTimeout(timeoutId);
    }, [delay, value]);

    return debouncedValue;
};

const useWindowWidth = (): number => {
    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return windowWidth;
};

const buildExamples = (): ExampleRecord[] =>
    exampleData.map((example, id) => ({
        id,
        ...example,
        searchField: `${example.title} ${example.description} ${(example.keywords || []).join(' ')}`.toLowerCase(),
        url: getExampleUrl(example),
    }));

const filterExamples = (examples: ExampleRecord[], search: string): ExampleRecord[] => {
    const parts = search
        .split(' ')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);

    if (parts.length === 0) {
        return examples;
    }

    return examples.filter((example) => parts.every((part) => example.searchField.includes(part)));
};

const copyText = async (value: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
};

const getCopyText = (scope: CopyScope, previewState: DiagramState, currentText: string): string => {
    const markdownBody = imageFiletypes.has(previewState.filetype)
        ? `![Diagram](${previewState.diagramUrl})`
        : `[Diagram ${previewState.filetype.toUpperCase()}](${previewState.diagramUrl})`;

    switch (scope) {
        case 'image':
            return previewState.diagramUrl;
        case 'edit':
            return previewState.diagramEditUrl;
        case 'markdown':
            return `${markdownBody}\n\n[Edit this diagram](${previewState.diagramEditUrl})\n`;
        case 'markdownsource':
            return `${markdownBody}\n\n<!--\n${currentText.split('-->').join('\\-\\-\\>')}\n-->\n\n[Edit this diagram](${previewState.diagramEditUrl})\n`;
        default:
            return '';
    }
};

interface PreviewPaneProps {
    diagramUrl: string;
    diagramEditUrl: string;
    diagramError: boolean;
    filetype: string;
    onDiagramError: (url: string) => void;
    onFiletypeChange: (filetype: string) => void;
    filetypes: string[];
}

const PreviewPane = ({
    diagramUrl,
    diagramEditUrl,
    diagramError,
    filetype,
    onDiagramError,
    onFiletypeChange,
    filetypes,
}: PreviewPaneProps): JSX.Element => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const transformApiRef = useRef<{
        zoomIn: () => void;
        zoomOut: () => void;
        centerView: (scale?: number, animationTime?: number) => void;
        resetTransform: () => void;
    } | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 960, height: 640 });
    const [imageBounds, setImageBounds] = useState<{ width: number; height: number } | null>(null);
    const isImageFiletype = imageFiletypes.has(filetype);

    const fitDiagramToViewport = () => {
        if (!transformApiRef.current || !imageBounds) {
            return;
        }

        const scaleX = viewportSize.width / imageBounds.width;
        const scaleY = viewportSize.height / imageBounds.height;
        const fittedScale = Math.min(scaleX, scaleY, 1);

        transformApiRef.current.centerView(fittedScale, 80);
    };

    useEffect(() => {
        const panelElement = panelRef.current;
        if (!panelElement) {
            return;
        }

        const updateSize = () => {
            const toolbarHeight = toolbarRef.current?.offsetHeight || 0;
            const nextWidth = Math.max(320, Math.floor(panelElement.clientWidth));
            const nextHeight = Math.max(240, Math.floor(panelElement.clientHeight - toolbarHeight));
            setViewportSize((current) => (
                current.width === nextWidth && current.height === nextHeight
                    ? current
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(panelElement);
        if (toolbarRef.current) {
            resizeObserver.observe(toolbarRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        setImageBounds(null);
    }, [diagramUrl]);

    useEffect(() => {
        if (isImageFiletype && imageBounds) {
            fitDiagramToViewport();
        }
    }, [diagramUrl, imageBounds, isImageFiletype, viewportSize.height, viewportSize.width]);

    return (
        <div className="Render" ref={panelRef}>
            <div className="RenderToolbar" ref={toolbarRef}>
                <div className="RenderToolbarBadge">
                    <OutputFormatGroup
                        filetype={filetype}
                        filetypes={filetypes}
                        onChange={onFiletypeChange}
                    />
                </div>
                {isImageFiletype ? (
                    <>
                        <button type="button" className="RenderToolbarButton" onClick={() => transformApiRef.current?.zoomOut()}>
                            -
                        </button>
                        <button type="button" className="RenderToolbarButton" onClick={() => transformApiRef.current?.zoomIn()}>
                            +
                        </button>
                        <button type="button" className="RenderToolbarButton RenderToolbarButtonWide" onClick={() => fitDiagramToViewport()}>
                            Fit
                        </button>
                    </>
                ) : null}
                <a className="RenderToolbarLink" href={diagramUrl} target="_blank" rel="noreferrer">
                    Open
                </a>
                <a className="RenderToolbarLink RenderToolbarLinkAccent" href={diagramEditUrl} target="_blank" rel="noreferrer">
                    Edit
                </a>
            </div>
            {isImageFiletype ? (
                <TransformWrapper
                    minScale={0.25}
                    maxScale={48}
                    centerOnInit
                    centerZoomedOut
                    wheel={{ step: 0.12 }}
                    pinch={{ step: 4 }}
                    panning={{ velocityDisabled: true }}
                    doubleClick={{ disabled: true }}
                >
                    {(controls) => {
                        transformApiRef.current = controls;
                        return (
                            <div className="RenderViewport" style={{ height: `${viewportSize.height}px` }}>
                                {diagramError ? (
                                    <iframe className="RenderImageError" title="Error" src={diagramUrl} />
                                ) : (
                                    <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
                                        <div className="RenderCanvas" style={{ width: `${viewportSize.width}px`, minHeight: `${viewportSize.height}px` }}>
                                            <img
                                                alt="Diagram"
                                                className="RenderImage"
                                                src={diagramUrl}
                                                onError={() => onDiagramError(diagramUrl)}
                                                onLoad={(event) => {
                                                    const target = event.currentTarget;
                                                    setImageBounds({
                                                        width: target.naturalWidth || target.clientWidth || viewportSize.width,
                                                        height: target.naturalHeight || target.clientHeight || viewportSize.height,
                                                    });
                                                }}
                                                style={{ maxWidth: `${viewportSize.width}px`, maxHeight: `${viewportSize.height}px` }}
                                            />
                                        </div>
                                    </TransformComponent>
                                )}
                            </div>
                        );
                    }}
                </TransformWrapper>
            ) : (
                <div className="RenderViewport" style={{ height: `${viewportSize.height}px` }}>
                    <iframe className="RenderDocument" title={`Diagram ${filetype}`} src={diagramUrl} />
                </div>
            )}
        </div>
    );
};

interface ModalProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    actions?: React.ReactNode;
    headerExtras?: React.ReactNode;
}

const Modal = ({ open, title, onClose, children, actions, headerExtras }: ModalProps): JSX.Element | null => {
    if (!open) {
        return null;
    }

    return (
        <div className="ModalBackdrop" onClick={onClose}>
            <div className="ModalSurface" onClick={(event) => event.stopPropagation()}>
                <div className="ModalHeader">
                    <h2>{title}</h2>
                    <div className="ModalHeaderExtras">{headerExtras}</div>
                </div>
                <div className="ModalBody">{children}</div>
                <div className="ModalFooter">
                    {actions}
                    <button type="button" className="ModalButton" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

function App(): JSX.Element {
    const baseUrl = useMemo(() => window.location.origin + window.location.pathname, []);
    const initialRenderUrl = normalizeRenderUrl(window.config?.krokiEngineUrl || defaultRenderUrl);
    const initialDiagramState = useMemo(() => {
        const state = createInitialDiagramState(baseUrl, window.location.hash);
        return state.renderUrl === initialRenderUrl ? state : buildDiagramState({ ...state, renderUrl: initialRenderUrl });
    }, [baseUrl, initialRenderUrl]);
    const examples = useMemo(() => buildExamples(), []);

    const [diagramType, setDiagramType] = useState(initialDiagramState.diagramType);
    const [filetype, setFiletype] = useState(initialDiagramState.filetype);
    const [renderUrl, setRenderUrl] = useState(initialDiagramState.renderUrl);
    const [editorValue, setEditorValue] = useState(initialDiagramState.diagramText);
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('vertical');
    const [wrapEnabled, setWrapEnabled] = useState(true);
    const [linksOpen, setLinksOpen] = useState(false);
    const [editorWidth, setEditorWidth] = useState(44);
    const [isDragging, setIsDragging] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab>('code');
    const [diagramError, setDiagramError] = useState(false);
    const [examplesMode, setExamplesMode] = useState<'grid' | 'detail' | null>(null);
    const [selectedExampleId, setSelectedExampleId] = useState(0);
    const [examplesSearch, setExamplesSearch] = useState('');
    const [importUrlOpen, setImportUrlOpen] = useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [copiedScopes, setCopiedScopes] = useState<Record<CopyScope, boolean>>({
        image: false,
        edit: false,
        markdown: false,
        markdownsource: false,
    });
    const workspaceRef = useRef<HTMLDivElement | null>(null);

    const debouncedEditorValue = useDebouncedValue(editorValue, 500);
    const windowWidth = useWindowWidth();
    const isCompact = windowWidth < 980;
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
        diagramText: debouncedEditorValue,
        filetype,
        renderUrl,
    }), [baseUrl, debouncedEditorValue, diagramType, filetype, renderUrl]);
    const filteredExamples = useMemo(() => filterExamples(examples, examplesSearch), [examples, examplesSearch]);
    const selectedExample = examples[selectedExampleId] || examples[0];
    const supportedFiletypes = diagramTypes[diagramType]?.filetypes || [filetype];

    useEffect(() => {
        if (!isCompact) {
            setMobileTab('code');
        }
    }, [isCompact]);

    useEffect(() => {
        setDiagramError(false);
    }, [previewState.diagramUrl]);

    useEffect(() => {
        const nextHash = `#${previewState.diagramUrl}`;
        if (window.location.hash !== nextHash) {
            window.history.replaceState(null, '', nextHash);
        }
    }, [previewState.diagramUrl]);

    useEffect(() => {
        const handleHashChange = () => {
            const parsed = parseDiagramUrl(window.location.hash);
            if (!parsed) {
                return;
            }

            setDiagramType(parsed.diagramType);
            setFiletype(parsed.filetype);
            setRenderUrl(parsed.renderUrl);
            setEditorValue(parsed.diagramText);
            setDiagramError(false);
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
                setLinksOpen(false);
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

    const showEditorPane = !isCompact ? layoutMode !== 'preview' : mobileTab === 'code';
    const showPreviewPane = !isCompact ? true : mobileTab === 'preview';

    const handleDiagramTypeChange = (nextDiagramType: string) => {
        const nextState = changeDiagramType(currentState, nextDiagramType);
        setDiagramType(nextState.diagramType);
        setFiletype(nextState.filetype);
        setEditorValue(nextState.diagramText);
    };

    const handleImportUrl = () => {
        const parsed = parseDiagramUrl(importUrl);
        if (!parsed) {
            return;
        }

        setDiagramType(parsed.diagramType);
        setFiletype(parsed.filetype);
        setRenderUrl(parsed.renderUrl);
        setEditorValue(parsed.diagramText);
        setImportUrlOpen(false);
        setImportUrl('');
    };

    const handleExampleImport = (example: ExampleRecord) => {
        setDiagramType(example.diagramType);
        setFiletype(getValidFiletype(example.diagramType, filetype));
        setEditorValue(decode(example.example));
        setExamplesMode(null);
    };

    const handleCopy = async (scope: CopyScope) => {
        const text = getCopyText(scope, previewState, editorValue);
        await copyText(text);
        setCopiedScopes((current) => ({ ...current, [scope]: true }));
        window.setTimeout(() => {
            setCopiedScopes((current) => ({ ...current, [scope]: false }));
        }, 1000);
    };

    return (
        <div className="App">
            <header className="AppToolbar">
                <div className="AppToolbarBrand">
                    <span className="AppToolbarLogo">Niolesk</span>
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
                    {!isCompact ? (
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
                    <button type="button" className="AppToolbarButton" onClick={() => { setExamplesMode('grid'); setExamplesSearch(''); }}>
                        Examples
                    </button>
                    <button type="button" className="AppToolbarButton" onClick={() => setImportUrlOpen(true)}>
                        Import
                    </button>
                </div>
            </header>

            {isCompact ? (
                <div className="WorkspaceMobileTabs">
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
                </div>
            ) : null}

            <main className="MainPanel">
                <div
                    className={`Workspace WorkspaceMode${layoutMode[0].toUpperCase()}${layoutMode.slice(1)}`}
                    ref={workspaceRef}
                    style={{ ['--editor-panel-width' as string]: `${editorWidth}%` }}
                >
                    <section className={`WorkspacePanel WorkspacePanelEditor${showEditorPane ? '' : ' compactHidden'}`}>
                        {!isCompact ? (
                            <div className="WorkspacePanelBar">
                                <div className="WorkspacePanelBarSpacer" />
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
                                    language={currentState.language || 'plaintext'}
                                    value={editorValue}
                                    onChange={(value) => setEditorValue(value || '')}
                                    height="100%"
                                    options={{
                                        theme: 'vs',
                                        automaticLayout: true,
                                        folding: true,
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        lineHeight: 22,
                                        padding: { top: 18, bottom: 18 },
                                        scrollBeyondLastLine: false,
                                        smoothScrolling: true,
                                        wordWrap: wrapEnabled ? 'on' : 'off',
                                        wrappingIndent: 'indent',
                                    }}
                                />
                            </div>
                        </div>
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
                                diagramUrl={previewState.diagramUrl}
                                diagramEditUrl={previewState.diagramEditUrl}
                                diagramError={diagramError}
                                filetype={filetype}
                                filetypes={supportedFiletypes}
                                onDiagramError={(url) => {
                                    if (url === previewState.diagramUrl) {
                                        setDiagramError(true);
                                    }
                                }}
                                onFiletypeChange={setFiletype}
                            />
                        </div>
                    </section>
                </div>
            </main>

            <section className={`LinksDrawer${linksOpen ? ' open' : ''}`}>
                <button type="button" className="LinksDrawerHandle" onClick={() => setLinksOpen((current) => !current)}>
                    <span className="LinksDrawerHandleText">
                        <strong>Generated Links</strong>
                    </span>
                    <span className="LinksDrawerHandleState">{linksOpen ? 'Close' : 'Open'}</span>
                </button>
                <div className="LinksDrawerBody">
                    <div className="LinksDrawerControls">
                        <label className="AppTextField RenderUrlField">
                            <span className="AppTextFieldLabel">Kroki engine</span>
                            <input
                                className="AppTextControl RenderUrlInput code"
                                value={renderUrl}
                                onChange={(event) => setRenderUrl(normalizeRenderUrl(event.target.value))}
                                placeholder={defaultRenderUrl}
                            />
                        </label>
                    </div>
                    <div className="CopyZone">
                        <div className="CopyZoneGrid">
                            {copyScopes.map((scope) => (
                                <div key={scope} className="CopyZoneField">
                                    <label>
                                        {scope === 'image' ? 'Render URL' : null}
                                        {scope === 'edit' ? 'Edit URL' : null}
                                        {scope === 'markdown' ? 'Markdown snippet' : null}
                                        {scope === 'markdownsource' ? 'Markdown with source comment' : null}
                                    </label>
                                    <div className={`CopyField${copiedScopes[scope] ? ' copied' : ''}`}>
                                        <textarea
                                            className="CopyFieldPre code"
                                            rows={scope === 'markdownsource' || scope === 'markdown' ? 4 : 1}
                                            value={getCopyText(scope, previewState, editorValue)}
                                            readOnly
                                        />
                                        <button type="button" className="CopyButton" onClick={() => handleCopy(scope)}>
                                            {copiedScopes[scope] ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

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
                                <img alt={example.title} src={example.url} />
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
                        <img alt={selectedExample.title} src={selectedExample.url} />
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
                        placeholder={`${defaultRenderUrl}diagramType/svg/encoded`}
                        value={importUrl}
                        onChange={(event) => setImportUrl(event.target.value)}
                    />
                </div>
            </Modal>
        </div>
    );
}

export default App;
