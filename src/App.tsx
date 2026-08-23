import { useEffect, useMemo, useState } from 'react';
import {
    Code2,
    Download,
    Eye,
    FileText,
    Library,
    Link2,
    Monitor,
    Settings,
    Users,
} from 'lucide-react';
import CodeMirrorEditor from './editor/CodeMirrorEditor';
import type { DiagramValidationMarker } from './editor/languages/types';
import cheatSheets from './data/cheatSheets';
import { createRemoteExportAdapter, exportDiagram, type ExportFormat } from './export/export';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { getBrowserRenderCapabilities, useDiagramRender } from './hooks/useDiagramRender';
import { useWindowWidth } from './hooks/useWindowWidth';
import { decode } from './kroki/coder';
import {
    defaultPreferences,
    getConsentedRemoteRenderer,
    loadPreferences,
    savePreferences,
    type Preferences,
    type RemoteRenderingChoice,
} from './preferences/preferences';
import { loadRuntimeConfig } from './runtimeConfig';
import {
    buildDiagramState,
    createInitialDiagramState,
    defaultRenderUrl,
    diagramTypes,
    normalizeRenderUrl,
    parseDiagramUrl,
} from './state';
import type { ExampleRecord } from './types';
import { buildExamples, filterExamples } from './utils/examples';
import './styles.css';

type MobileSection = 'code' | 'preview' | 'examples' | 'settings';

const mobileSections: Array<{
    id: MobileSection;
    label: string;
    Icon: typeof Code2;
}> = [
    { id: 'code', label: 'Code', Icon: Code2 },
    { id: 'preview', label: 'Preview', Icon: Eye },
    { id: 'examples', label: 'Examples', Icon: Library },
    { id: 'settings', label: 'Settings', Icon: Settings },
];

const getSystemAppearance = (): 'light' | 'dark' => (
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
);

const ConsentInterstitial = ({ onChoose }: {
    onChoose: (choice: RemoteRenderingChoice) => void;
}) => (
    <main className="ConsentScreen">
        <section className="ConsentCard" aria-labelledby="consent-title">
            <div className="ConsentSymbol"><FileText aria-hidden="true" /></div>
            <p className="Eyebrow">Welcome to neolesk</p>
            <h1 id="consent-title">Keep diagrams where you expect</h1>
            <p className="ConsentIntro">
                Most diagrams can render in this browser. Some languages and file exports need a server,
                so neolesk asks before sending diagram source anywhere.
            </p>
            <div className="ConsentChoices">
                <button type="button" className="ChoiceButton ChoiceButtonPrimary" aria-label="Render locally only" onClick={() => onChoose('local-only')}>
                    <Monitor aria-hidden="true" />
                    <span><strong>Render locally only</strong><small>Never send diagram source over the network</small></span>
                </button>
                <button type="button" className="ChoiceButton" onClick={() => onChoose('neolesk')}>
                    <Users aria-hidden="true" />
                    <span><strong>Use neolesk services</strong><small>Allow fallback rendering and collaboration</small></span>
                </button>
                <button type="button" className="ChoiceButton" onClick={() => onChoose('kroki-io')}>
                    <Link2 aria-hidden="true" />
                    <span><strong>Use kroki.io</strong><small>Send unsupported diagrams to the public Kroki service</small></span>
                </button>
            </div>
            <p className="ConsentFootnote">You can change this choice in Settings at any time.</p>
        </section>
    </main>
);

const SettingsView = ({ preferences, onChange }: {
    preferences: Preferences;
    onChange: (next: Preferences) => void;
}) => (
    <section className="SettingsView" aria-labelledby="settings-heading">
        <header>
            <p className="Eyebrow">Workspace</p>
            <h2 id="settings-heading">Settings</h2>
        </header>
        <div className="SettingsGroup">
            <label>
                <span>Appearance</span>
                <select
                    value={preferences.appearance}
                    onChange={(event) => onChange({ ...preferences, appearance: event.target.value as Preferences['appearance'] })}
                >
                    <option value="auto">Automatic</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
            </label>
            <label>
                <span>Remote rendering</span>
                <select
                    value={preferences.remoteRendering || 'local-only'}
                    onChange={(event) => onChange({
                        ...preferences,
                        remoteRendering: event.target.value as RemoteRenderingChoice,
                    })}
                >
                    <option value="local-only">Local only</option>
                    <option value="neolesk">neolesk services</option>
                    <option value="kroki-io">kroki.io</option>
                </select>
            </label>
            <label className="ToggleSetting">
                <span><strong>Wrap long lines</strong><small>Keep source visible without horizontal scrolling</small></span>
                <input
                    type="checkbox"
                    checked={preferences.editorWrapping}
                    onChange={(event) => onChange({ ...preferences, editorWrapping: event.target.checked })}
                />
            </label>
            <label>
                <span>Window transparency</span>
                <input
                    type="range"
                    min="0.55"
                    max="1"
                    step="0.05"
                    value={preferences.transparency}
                    onChange={(event) => onChange({ ...preferences, transparency: Number(event.target.value) })}
                />
            </label>
        </div>
    </section>
);

const ExamplesView = ({ examples, onSelect }: {
    examples: ExampleRecord[];
    onSelect: (example: ExampleRecord) => void;
}) => {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => filterExamples(examples, query), [examples, query]);
    return (
        <section className="ExamplesView" aria-labelledby="examples-heading">
            <header>
                <div><p className="Eyebrow">Starting points</p><h2 id="examples-heading">Examples</h2></div>
                <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search examples"
                    aria-label="Search examples"
                />
            </header>
            <div className="ExampleGrid">
                {filtered.map((example) => (
                    <button type="button" key={example.id} onClick={() => onSelect(example)}>
                        <strong>{example.title}</strong>
                        <span>{diagramTypes[example.diagramType]?.name || example.diagramType}</span>
                        <small>{example.description}</small>
                    </button>
                ))}
            </div>
        </section>
    );
};

function EditorApplication({
    preferences,
    onPreferencesChange,
}: {
    preferences: Preferences;
    onPreferencesChange: (preferences: Preferences) => void;
}) {
    const baseUrl = useMemo(() => window.location.origin + window.location.pathname, []);
    const initialState = useMemo(() => createInitialDiagramState(baseUrl, window.location.hash), [baseUrl]);
    const [language, setLanguage] = useState(initialState.diagramType);
    const [source, setSource] = useState(initialState.diagramText);
    const [previewSource, setPreviewSource] = useState(initialState.diagramText);
    const [drafts, setDrafts] = useState<Record<string, string>>({ [initialState.diagramType]: initialState.diagramText });
    const [renderUrl, setRenderUrl] = useState(normalizeRenderUrl(__KROKI_ENGINE_URL__ || defaultRenderUrl));
    const [sessionBackendUrl, setSessionBackendUrl] = useState<string | null>(null);
    const [mobileSection, setMobileSection] = useState<MobileSection>('code');
    const [sidebar, setSidebar] = useState<'examples' | 'syntax'>('examples');
    const [exportOpen, setExportOpen] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const width = useWindowWidth();
    const compact = width < 760;
    const examples = useMemo(() => buildExamples(), []);
    const debouncedSource = useDebouncedValue(source, 350);
    const appearance = preferences.appearance === 'auto' ? getSystemAppearance() : preferences.appearance;
    const remote = useMemo(
        () => getConsentedRemoteRenderer(preferences.remoteRendering, renderUrl),
        [preferences.remoteRendering, renderUrl],
    );
    const renderState = useDiagramRender({ language, source: previewSource, remote });
    const capabilities = useMemo(() => getBrowserRenderCapabilities(language), [language]);

    const remoteMarkers = useMemo<DiagramValidationMarker[]>(() => renderState.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        startLineNumber: diagnostic.line || 1,
        startColumn: diagnostic.column || 1,
        endLineNumber: diagnostic.line || 1,
        endColumn: (diagnostic.column || 1) + 1,
        severity: diagnostic.kind === 'render' ? 'error' : 'warning',
    })), [renderState.diagnostics]);

    const provenanceLabel = renderState.provenance?.kind === 'remote'
        ? renderState.provenance.rendererLabel
        : capabilities.local ? 'On this device' : remote?.label || 'Server required';

    useEffect(() => setPreviewSource(debouncedSource), [debouncedSource]);

    useEffect(() => {
        let active = true;
        loadRuntimeConfig().then((outcome) => {
            if (!active) return;
            if (outcome.status === 'invalid') {
                console.error(`[neolesk] ignoring runtime config: ${outcome.reason}`);
                return;
            }
            if (outcome.status === 'loaded') {
                setRenderUrl(normalizeRenderUrl(outcome.config.renderServerUrl || outcome.config.krokiEngineUrl || renderUrl));
                setSessionBackendUrl(outcome.config.sessionBackendUrl || null);
            }
        });
        return () => { active = false; };
    }, []); // Runtime configuration is intentionally loaded once.

    useEffect(() => {
        const state = buildDiagramState({
            baseUrl,
            diagramType: language,
            diagramText: previewSource,
            filetype: 'svg',
            renderUrl,
        });
        const nextHash = `#${state.diagramHash}`;
        if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
    }, [baseUrl, language, previewSource, renderUrl]);

    useEffect(() => {
        const onHashChange = () => {
            const parsed = parseDiagramUrl(window.location.hash);
            if (!parsed) return;
            setLanguage(parsed.diagramType);
            setSource(parsed.diagramText);
            setPreviewSource(parsed.diagramText);
            setDrafts((current) => ({ ...current, [parsed.diagramType]: parsed.diagramText }));
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    const updateSource = (nextSource: string) => {
        setSource(nextSource);
        setDrafts((current) => ({ ...current, [language]: nextSource }));
    };

    const changeLanguage = (nextLanguage: string) => {
        setDrafts((current) => ({ ...current, [language]: source }));
        const nextSource = drafts[nextLanguage] || decode(diagramTypes[nextLanguage].example);
        setLanguage(nextLanguage);
        setSource(nextSource);
        setPreviewSource(nextSource);
    };

    const selectExample = (example: ExampleRecord) => {
        const nextSource = decode(example.example);
        setLanguage(example.diagramType);
        setSource(nextSource);
        setPreviewSource(nextSource);
        setDrafts((current) => ({ ...current, [example.diagramType]: nextSource }));
        setMobileSection('code');
    };

    const copySnapshot = async () => {
        await navigator.clipboard?.writeText(window.location.href);
        setStatusMessage('Snapshot link copied');
    };

    const download = async (format: ExportFormat) => {
        setExportOpen(false);
        if (!renderState.svgText) return;
        try {
            const blob = await exportDiagram({
                format,
                svg: renderState.svgText,
                language,
                source,
                remote,
                remoteExport: createRemoteExportAdapter(),
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `diagram.${format}`;
            anchor.click();
            URL.revokeObjectURL(url);
            setStatusMessage(`${format.toUpperCase()} exported`);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : String(error));
        }
    };

    const editor = (
        <section className="EditorPanel" aria-label="Code editor">
            <CodeMirrorEditor
                diagramType={language}
                value={source}
                wrapping={preferences.editorWrapping}
                appearance={appearance}
                markers={remoteMarkers}
                onChange={updateSource}
            />
        </section>
    );

    const preview = (
        <section className="PreviewPanel" aria-label="Diagram preview">
            {renderState.loading && <div className="PreviewState">Rendering…</div>}
            {!renderState.loading && renderState.blobUrl && (
                <img src={renderState.blobUrl} alt="Rendered diagram" />
            )}
            {!renderState.loading && renderState.error && (
                <div className="PreviewError" role="alert">
                    <strong>{renderState.consentRequired ? 'Remote rendering is off' : 'Could not render this diagram'}</strong>
                    <p>{renderState.error.message}</p>
                    {renderState.consentRequired && (
                        <button type="button" onClick={() => onPreferencesChange({ ...preferences, remoteRendering: 'neolesk' })}>
                            Allow neolesk services
                        </button>
                    )}
                </div>
            )}
        </section>
    );

    const syntax = cheatSheets[language];

    return (
        <div
            className="App"
            data-appearance={preferences.appearance}
            style={{ '--window-opacity': String(preferences.transparency) } as React.CSSProperties}
        >
            <header className="TopBar">
                <a className="Brand" href="/" aria-label="neolesk home"><span>neo</span>lesk</a>
                <div className="DocumentControls">
                    <select aria-label="Diagram language" value={language} onChange={(event) => changeLanguage(event.target.value)}>
                        {Object.entries(diagramTypes).map(([id, definition]) => (
                            <option key={id} value={id}>{definition.name}</option>
                        ))}
                    </select>
                    <span className={`Provenance ${renderState.provenance?.kind === 'remote' ? 'remote' : ''}`}>
                        <span aria-hidden="true" />{provenanceLabel}
                    </span>
                </div>
                <div className="TopActions">
                    <button type="button" className="ToolbarButton" onClick={copySnapshot}><Link2 aria-hidden="true" /><span>Copy snapshot</span></button>
                    <button type="button" className="ToolbarButton" disabled={!sessionBackendUrl}><Users aria-hidden="true" /><span>New session</span></button>
                    <div className="ExportControl">
                        <button type="button" className="ToolbarButton Primary" onClick={() => setExportOpen((open) => !open)}>
                            <Download aria-hidden="true" /><span>Export</span>
                        </button>
                        {exportOpen && (
                            <div className="ExportMenu">
                                {(['svg', 'png', 'jpeg', 'pdf'] as const).map((format) => (
                                    <button type="button" key={format} onClick={() => download(format)}>
                                        {format.toUpperCase()}{format !== 'svg' && !remote ? <small>Requires server</small> : null}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {!sessionBackendUrl && <div className="DeploymentNotice">Sessions unavailable in this deployment</div>}
            {statusMessage && <div className="StatusMessage" role="status">{statusMessage}</div>}

            {compact ? (
                <main className="CompactWorkspace">
                    <div className="CompactContent">
                        {mobileSection === 'code' && editor}
                        {mobileSection === 'preview' && preview}
                        {mobileSection === 'examples' && <ExamplesView examples={examples} onSelect={selectExample} />}
                        {mobileSection === 'settings' && <SettingsView preferences={preferences} onChange={onPreferencesChange} />}
                    </div>
                    <nav className="MobileTabs" role="tablist" aria-label="Editor sections">
                        {mobileSections.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={mobileSection === id}
                                onClick={() => setMobileSection(id)}
                            >
                                <Icon aria-hidden="true" /><span>{label}</span>
                            </button>
                        ))}
                    </nav>
                </main>
            ) : (
                <main className="DesktopWorkspace">
                    <aside className="Sidebar">
                        <div className="SidebarSwitcher" role="tablist" aria-label="Reference browser">
                            <button type="button" role="tab" aria-selected={sidebar === 'examples'} onClick={() => setSidebar('examples')}>Examples</button>
                            <button type="button" role="tab" aria-selected={sidebar === 'syntax'} onClick={() => setSidebar('syntax')}>Syntax</button>
                        </div>
                        {sidebar === 'examples' ? (
                            <div className="SidebarList">
                                {examples.filter((example) => example.diagramType === language).map((example) => (
                                    <button type="button" key={example.id} onClick={() => selectExample(example)}>
                                        <span className="DocumentIcon"><FileText aria-hidden="true" /></span>
                                        <span><strong>{example.title}</strong><small>{example.description}</small></span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="SyntaxReference">
                                <p>{syntax?.summary || 'No syntax reference is available for this language yet.'}</p>
                                {syntax?.sections.map((section) => (
                                    <section key={section.heading}>
                                        <h3>{section.heading}</h3>
                                        <pre>{section.items.join('\n')}</pre>
                                    </section>
                                ))}
                            </div>
                        )}
                    </aside>
                    <section className="CanvasSplit">
                        <div className="Pane">
                            <header><span>Source</span><small>{source === previewSource ? 'Up to date' : 'Editing…'}</small></header>
                            {editor}
                        </div>
                        <div className="Pane PreviewPane">
                            <header><span>Preview</span><small>{renderState.dimensions ? `${renderState.dimensions.width} × ${renderState.dimensions.height}` : 'Live preview'}</small></header>
                            {preview}
                        </div>
                    </section>
                    <aside className="DesktopSettings">
                        <SettingsView preferences={preferences} onChange={onPreferencesChange} />
                    </aside>
                </main>
            )}
        </div>
    );
}

function App() {
    const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences(window.localStorage));

    const updatePreferences = (next: Preferences) => {
        setPreferences(next);
        savePreferences(window.localStorage, next);
    };

    if (!preferences.remoteRendering) {
        return <ConsentInterstitial onChoose={(remoteRendering) => updatePreferences({ ...defaultPreferences, remoteRendering })} />;
    }

    return <EditorApplication preferences={preferences} onPreferencesChange={updatePreferences} />;
}

export default App;
