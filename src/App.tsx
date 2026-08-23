import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Code2,
    ChevronDown,
    Download,
    Eye,
    FileText,
    Library,
    Link2,
    Monitor,
    Settings,
    Users,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import CodeMirrorEditor, { type CollaborationBinding } from './editor/CodeMirrorEditor';
import type { DiagramValidationMarker } from './editor/languages/types';
import cheatSheets from './data/cheatSheets';
import {
    createManagedCellExportAdapter,
    createRemoteExportAdapter,
    createSessionExportAdapter,
    exportDiagram,
    type ExportFormat,
} from './export/export';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { getBrowserRenderCapabilities, useDiagramRender } from './hooks/useDiagramRender';
import { useWindowWidth } from './hooks/useWindowWidth';
import { decode } from './kroki/coder';
import {
    consentServerForChoice,
    getConsentedRemoteRenderer,
    loadPreferences,
    savePreferences,
    type Preferences,
    type RemoteRenderingChoice,
} from './preferences/preferences';
import { loadRuntimeConfig } from './runtimeConfig';
import {
    createSession,
    createSessionAvailabilityProbe,
    createSessionClient,
    getSessionIdFromPath,
    type SessionLinks,
} from './session/sessionClient';
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

interface ParticipantViewModel {
    panel: MobileSection;
    sidebar: 'examples' | 'syntax';
    theme: Preferences['appearance'];
    splitPercent: number;
    zoom: number;
    scrollTop: number;
    scrollLeft: number;
    previewScrollTop: number;
    previewScrollLeft: number;
}

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

const ConsentInterstitial = ({ renderServerUrl, onChoose }: {
    renderServerUrl: string;
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
                    <span><strong>Render locally only</strong><small>Never send diagram source to a rendering service</small></span>
                </button>
                <button type="button" className="ChoiceButton" onClick={() => onChoose('neolesk')}>
                    <Users aria-hidden="true" />
                    <span><strong>Use neolesk services</strong><small>Allow fallback rendering at {new URL(renderServerUrl).host} and collaboration</small></span>
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

const SettingsView = ({ preferences, renderServerUrl, onChange }: {
    preferences: Preferences;
    renderServerUrl: string;
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
                        consentedRenderServer: consentServerForChoice(
                            event.target.value as RemoteRenderingChoice,
                            renderServerUrl,
                        ),
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

const ExamplesView = ({ examples, onSelect, disabled = false }: {
    examples: ExampleRecord[];
    onSelect: (example: ExampleRecord) => void;
    disabled?: boolean;
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
                    <button type="button" key={example.id} disabled={disabled} onClick={() => onSelect(example)}>
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
    renderUrl,
    sessionBackendUrl,
    onPreferencesChange,
}: {
    preferences: Preferences;
    renderUrl: string;
    sessionBackendUrl: string | null;
    onPreferencesChange: (preferences: Preferences) => void;
}) {
    const baseUrl = useMemo(() => `${window.location.origin}/`, []);
    const initialState = useMemo(() => createInitialDiagramState(baseUrl, window.location.hash), [baseUrl]);
    const [language, setLanguage] = useState(initialState.diagramType);
    const [source, setSource] = useState(initialState.diagramText);
    const [previewSource, setPreviewSource] = useState(initialState.diagramText);
    const [drafts, setDrafts] = useState<Record<string, string>>({ [initialState.diagramType]: initialState.diagramText });
    const [sessionId, setSessionId] = useState<string | null>(() => getSessionIdFromPath(window.location.pathname));
    const [activeSession, setActiveSession] = useState<SessionLinks | null>(null);
    const [collaboration, setCollaboration] = useState<CollaborationBinding | null>(null);
    const [sessionParticipantId, setSessionParticipantId] = useState<string | null>(null);
    const [presence, setPresence] = useState<'offline' | 'connected' | 'disconnected'>('offline');
    const [agentPresence, setAgentPresence] = useState<'offline' | 'connected' | 'disconnected'>('offline');
    const [agentActivity, setAgentActivity] = useState<string | null>(null);
    const exportDragStart = useRef<number | null>(null);
    const previewRef = useRef<HTMLElement | null>(null);
    const [view, setView] = useState<ParticipantViewModel>({
        panel: 'code',
        sidebar: 'examples',
        theme: preferences.appearance,
        splitPercent: 50,
        zoom: 1,
        scrollTop: 0,
        scrollLeft: 0,
        previewScrollTop: 0,
        previewScrollLeft: 0,
    });
    const [exportOpen, setExportOpen] = useState(false);
    const [exportDetent, setExportDetent] = useState<'compact' | 'expanded'>('compact');
    const [viewHydrated, setViewHydrated] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const width = useWindowWidth();
    const compact = width < 1100;
    const mobileSection = view.panel;
    const sidebar = view.sidebar;
    const examples = useMemo(() => buildExamples(), []);
    const debouncedSource = useDebouncedValue(source, 350);
    const appearance = view.theme === 'auto' ? getSystemAppearance() : view.theme;
    const remote = useMemo(
        () => getConsentedRemoteRenderer(preferences.remoteRendering, preferences.consentedRenderServer, renderUrl),
        [preferences.remoteRendering, preferences.consentedRenderServer, renderUrl],
    );
    const renderState = useDiagramRender({ language, source: previewSource, remote });
    const capabilities = useMemo(() => getBrowserRenderCapabilities(language), [language]);
    const sessionReady = !sessionId || Boolean(collaboration);

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
        setView((current) => current.theme === preferences.appearance
            ? current
            : { ...current, theme: preferences.appearance });
    }, [preferences.appearance]);

    useEffect(() => {
        const previewElement = previewRef.current;
        if (!previewElement) return;
        if (Math.abs(previewElement.scrollTop - view.previewScrollTop) > 1) {
            previewElement.scrollTop = view.previewScrollTop;
        }
        if (Math.abs(previewElement.scrollLeft - view.previewScrollLeft) > 1) {
            previewElement.scrollLeft = view.previewScrollLeft;
        }
    }, [view.previewScrollLeft, view.previewScrollTop]);

    useEffect(() => {
        if (!sessionBackendUrl || !sessionId) return undefined;
        let active = true;
        let client: ReturnType<typeof createSessionClient> | null = null;
        const leaveSession = (message: string) => {
            if (!active) return;
            setActiveSession(null);
            setSessionId(null);
            setCollaboration(null);
            setSessionParticipantId(null);
            setPresence('offline');
            setAgentPresence('offline');
            setAgentActivity(null);
            window.history.replaceState(null, '', '/');
            setStatusMessage(message);
        };
        const connect = async () => {
            const stateUrl = new URL(`/api/sessions/${sessionId}/state`, sessionBackendUrl).href;
            const canReconnect = createSessionAvailabilityProbe(sessionBackendUrl, sessionId);
            try {
                const response = await fetch(stateUrl, { headers: { accept: 'application/json' } });
                if (!active) return;
                if (response.status === 404 || response.status === 410) {
                    leaveSession('Session expired. Continuing as a local snapshot.');
                    return;
                }
            } catch {
                // The WebSocket reconnect loop handles temporary network failures.
            }
            if (!active) return;
            const websocketUrl = new URL(`/api/sessions/${sessionId}/connect`, sessionBackendUrl);
            websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
            client = createSessionClient({
                websocketUrl: websocketUrl.href,
                onBinding: setCollaboration,
                onState: (state) => {
                    setLanguage(state.language);
                    setSource(state.source);
                    setPreviewSource(state.source);
                    setDrafts((current) => ({ ...current, [state.language]: state.source }));
                },
                onPresence: (event) => {
                    if (event.state !== 'connected' && event.state !== 'disconnected') return;
                    if (event.actor === 'agent') setAgentPresence(event.state);
                    else setPresence(event.state);
                },
                onActivity: (activity) => {
                    if (activity.actor !== 'agent') return;
                    setAgentActivity(activity.fields.length > 0
                        ? `Agent changed ${activity.fields.join(' and ')}`
                        : 'Agent active');
                },
                onError: setStatusMessage,
                onClosed: (reason) => leaveSession(reason === 'expired'
                    ? 'Session expired. Continuing as a local snapshot.'
                    : 'Session closed. Continuing as a local snapshot.'),
                canReconnect,
            });
            client.connect();
            setSessionParticipantId(client.participantId());
            setPresence('disconnected');
        };
        void connect();
        return () => {
            active = false;
            client?.disconnect();
            setCollaboration(null);
            setSessionParticipantId(null);
            setAgentPresence('offline');
        };
    }, [sessionBackendUrl, sessionId]);

    useEffect(() => {
        if (!sessionBackendUrl || !sessionId || !sessionParticipantId) return undefined;
        let active = true;
        setViewHydrated(false);
        const endpoint = new URL(
            `/api/sessions/${sessionId}/view/${encodeURIComponent(sessionParticipantId)}`,
            sessionBackendUrl,
        ).href;
        fetch(endpoint).then(async (response) => {
            if (!active || !response.ok) return;
            const stored = await response.json() as Partial<ParticipantViewModel>;
            setView((current) => ({
                ...current,
                ...(stored.panel ? { panel: stored.panel } : {}),
                ...(stored.sidebar ? { sidebar: stored.sidebar } : {}),
                ...(stored.theme ? { theme: stored.theme } : {}),
                ...(typeof stored.splitPercent === 'number' ? { splitPercent: stored.splitPercent } : {}),
                ...(typeof stored.zoom === 'number' ? { zoom: stored.zoom } : {}),
                ...(typeof stored.scrollTop === 'number' ? { scrollTop: stored.scrollTop } : {}),
                ...(typeof stored.scrollLeft === 'number' ? { scrollLeft: stored.scrollLeft } : {}),
                ...(typeof stored.previewScrollTop === 'number' ? { previewScrollTop: stored.previewScrollTop } : {}),
                ...(typeof stored.previewScrollLeft === 'number' ? { previewScrollLeft: stored.previewScrollLeft } : {}),
            }));
        }).catch(() => { /* the reconnecting document remains usable */ }).finally(() => {
            if (active) setViewHydrated(true);
        });
        return () => { active = false; };
    }, [sessionBackendUrl, sessionId, sessionParticipantId]);

    useEffect(() => {
        if (!sessionBackendUrl || !sessionId || !sessionParticipantId || !viewHydrated) return undefined;
        const timeout = setTimeout(() => {
            void fetch(new URL(
                `/api/sessions/${sessionId}/view/${encodeURIComponent(sessionParticipantId)}`,
                sessionBackendUrl,
            ), {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(view),
            });
        }, 350);
        return () => clearTimeout(timeout);
    }, [sessionBackendUrl, sessionId, sessionParticipantId, view, viewHydrated]);

    useEffect(() => {
        if (sessionId) return;
        const state = buildDiagramState({
            baseUrl,
            diagramType: language,
            diagramText: previewSource,
            filetype: 'svg',
            renderUrl,
        });
        const nextHash = `#${state.diagramHash}`;
        if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
    }, [baseUrl, language, previewSource, renderUrl, sessionId]);

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

    const replaceDocument = (nextLanguage: string, nextSource: string, message: string) => {
        collaboration?.replaceDocument?.({ language: nextLanguage, source: nextSource }, message);
        if (collaboration && !collaboration.replaceDocument) {
            setStatusMessage('The live session is still connecting');
            return false;
        }
        setLanguage(nextLanguage);
        setSource(nextSource);
        setPreviewSource(nextSource);
        return true;
    };

    const changeLanguage = (nextLanguage: string) => {
        setDrafts((current) => ({ ...current, [language]: source }));
        const nextSource = drafts[nextLanguage] || decode(diagramTypes[nextLanguage].example);
        replaceDocument(nextLanguage, nextSource, 'Changed diagram language');
    };

    const selectExample = (example: ExampleRecord) => {
        const nextSource = decode(example.example);
        if (!replaceDocument(example.diagramType, nextSource, `Loaded ${example.title}`)) return;
        setDrafts((current) => ({ ...current, [example.diagramType]: nextSource }));
        setView((current) => ({ ...current, panel: 'code' }));
    };

    const copySnapshot = async () => {
        const snapshot = buildDiagramState({
            baseUrl,
            diagramType: language,
            diagramText: source,
            filetype: 'svg',
            renderUrl,
        });
        await navigator.clipboard?.writeText(snapshot.editUrl);
        setStatusMessage('Snapshot link copied');
    };

    const startSession = async () => {
        if (!sessionBackendUrl) return;
        try {
            const session = await createSession(sessionBackendUrl, { language, source });
            setActiveSession(session);
            setSessionId(session.id);
            const path = new URL(session.sessionUrl).pathname;
            window.history.pushState(null, '', path);
            setStatusMessage('Live session started');
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : String(error));
        }
    };

    const download = async (format: ExportFormat) => {
        setExportOpen(false);
        if (!renderState.svgText) return;
        try {
            if (sessionId && (!sessionBackendUrl || !sessionParticipantId)) {
                throw new Error('The live session is still connecting');
            }
            const rendererId = remote?.id === 'kroki-io' ? 'kroki-io' : 'neolesk';
            const remoteExport = sessionId && sessionBackendUrl && sessionParticipantId && remote
                ? createSessionExportAdapter({
                    backendUrl: sessionBackendUrl,
                    sessionId,
                    participantId: sessionParticipantId,
                    rendererId,
                })
                : sessionBackendUrl && remote
                    ? createManagedCellExportAdapter({ backendUrl: sessionBackendUrl, rendererId })
                    : createRemoteExportAdapter();
            const blob = await exportDiagram({
                format,
                svg: renderState.svgText,
                language,
                source,
                remote,
                remoteExport,
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
                scrollTop={view.scrollTop}
                scrollLeft={view.scrollLeft}
                onScroll={(position) => setView((current) => ({ ...current, ...position }))}
                collaboration={collaboration}
                editable={sessionReady}
            />
        </section>
    );

    const preview = (
        <section
            ref={previewRef}
            className="PreviewPanel"
            aria-label="Diagram preview"
            data-zoom={view.zoom}
            onScroll={(event) => setView((current) => ({
                ...current,
                previewScrollTop: event.currentTarget.scrollTop,
                previewScrollLeft: event.currentTarget.scrollLeft,
            }))}
        >
            <div className="PreviewZoom" aria-label="Preview zoom controls">
                <button type="button" aria-label="Zoom out" onClick={() => setView((current) => ({ ...current, zoom: Math.max(.25, current.zoom - .25) }))}><ZoomOut aria-hidden="true" /></button>
                <output aria-live="polite">{Math.round(view.zoom * 100)}%</output>
                <button type="button" aria-label="Zoom in" onClick={() => setView((current) => ({ ...current, zoom: Math.min(4, current.zoom + .25) }))}><ZoomIn aria-hidden="true" /></button>
            </div>
            {renderState.loading && <div className="PreviewState">Rendering…</div>}
            {!renderState.loading && renderState.blobUrl && (
                <img
                    src={renderState.blobUrl}
                    alt="Rendered diagram"
                    style={{ transform: `scale(${view.zoom})` }}
                />
            )}
            {!renderState.loading && renderState.error && (
                <div className="PreviewError" role="alert">
                    <strong>{renderState.consentRequired ? 'Remote rendering is off' : 'Could not render this diagram'}</strong>
                    <p>{renderState.error.message}</p>
                    {renderState.consentRequired && (
                        <button type="button" onClick={() => onPreferencesChange({
                            ...preferences,
                            remoteRendering: 'neolesk',
                            consentedRenderServer: consentServerForChoice('neolesk', renderUrl),
                        })}>
                            Allow neolesk services
                        </button>
                    )}
                </div>
            )}
        </section>
    );

    const syntax = cheatSheets[language];

    const moveSplitter = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.buttons !== 1 || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
        if (!bounds) return;
        const splitPercent = Math.min(80, Math.max(20, ((event.clientX - bounds.left) / bounds.width) * 100));
        setView((current) => ({ ...current, splitPercent }));
    };

    const settingsPreferences = { ...preferences, appearance: view.theme };
    const updateSettings = (next: Preferences) => {
        setView((current) => ({ ...current, theme: next.appearance }));
        onPreferencesChange(next);
    };

    return (
        <div
            className="App"
            data-appearance={view.theme}
            style={{ '--window-opacity': String(preferences.transparency) } as React.CSSProperties}
        >
            <svg className="LiquidGlassFilter" aria-hidden="true">
                <filter id="neolesk-liquid-glass" x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" seed="8" result="noise" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="B" />
                </filter>
            </svg>
            <header className="TopBar">
                <a className="Brand" href="/" aria-label="neolesk home"><span>neo</span>lesk</a>
                <div className="DocumentControls">
                    <details className="LanguagePicker">
                        <summary role="button" aria-label={`Diagram language: ${diagramTypes[language].name}`}>
                            <span>{diagramTypes[language].name}</span><ChevronDown aria-hidden="true" />
                        </summary>
                        <div className="LanguageMenu" role="listbox" aria-label="Diagram language">
                            {Object.entries(diagramTypes).map(([id, definition]) => (
                                <button
                                    key={id}
                                    type="button"
                                    role="option"
                                    aria-selected={id === language}
                                    disabled={!sessionReady}
                                    onClick={(event) => {
                                        changeLanguage(id);
                                        event.currentTarget.closest('details')?.removeAttribute('open');
                                    }}
                                >
                                    {definition.name}
                                </button>
                            ))}
                        </div>
                    </details>
                    <span className={`Provenance ${renderState.provenance?.kind === 'remote' ? 'remote' : ''}`}>
                        <span aria-hidden="true" />{provenanceLabel}
                    </span>
                </div>
                <div className="TopActions">
                    <button type="button" className="ToolbarButton" onClick={copySnapshot}><Link2 aria-hidden="true" /><span>Copy snapshot</span></button>
                    <button type="button" className="ToolbarButton" disabled={!sessionBackendUrl || Boolean(sessionId)} onClick={startSession}><Users aria-hidden="true" /><span>New session</span></button>
                    <div className="ExportControl">
                        <button type="button" className="ToolbarButton Primary" onClick={() => setExportOpen((open) => {
                            if (!open) setExportDetent('compact');
                            return !open;
                        })}>
                            <Download aria-hidden="true" /><span>Export</span>
                        </button>
                        {exportOpen && (
                            <div className="ExportMenu" role="dialog" aria-label="Export diagram" data-detent={exportDetent}>
                                <button
                                    type="button"
                                    className="SheetHandle"
                                    aria-label={exportDetent === 'compact' ? 'Expand export options' : 'Collapse export options'}
                                    onClick={() => {
                                        if (Number.isNaN(exportDragStart.current)) {
                                            exportDragStart.current = null;
                                            return;
                                        }
                                        setExportDetent((detent) => detent === 'compact' ? 'expanded' : 'compact');
                                    }}
                                    onPointerDown={(event) => {
                                        exportDragStart.current = event.clientY;
                                        event.currentTarget.setPointerCapture(event.pointerId);
                                    }}
                                    onPointerUp={(event) => {
                                        if (exportDragStart.current === null) return;
                                        const distance = event.clientY - exportDragStart.current;
                                        if (distance < -24) setExportDetent('expanded');
                                        if (distance > 24) setExportDetent('compact');
                                        exportDragStart.current = Math.abs(distance) > 24 ? Number.NaN : null;
                                    }}
                                ><span aria-hidden="true" /></button>
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
            {sessionId && (
                <div className="SessionNotice">
                    <span><span className={`PresenceDot ${presence}`} aria-hidden="true" />Live session</span>
                    <span><span className={`PresenceDot ${agentPresence}`} aria-hidden="true" />{agentPresence === 'connected' ? 'Agent connected' : 'Agent offline'}</span>
                    {agentActivity && <span className="AgentActivity">{agentActivity}</span>}
                    <button type="button" onClick={() => navigator.clipboard?.writeText(activeSession?.mcpUrl || `${window.location.origin}/mcp/${sessionId}`)}>Copy agent URL</button>
                </div>
            )}
            {statusMessage && <div className="StatusMessage" role="status">{statusMessage}</div>}

            {compact ? (
                <main className="CompactWorkspace">
                    <div className="CompactContent">
                        <section className="CompactPage" key={mobileSection} aria-labelledby={`mobile-${mobileSection}-title`}>
                            <h1 id={`mobile-${mobileSection}-title`}>{mobileSections.find((section) => section.id === mobileSection)?.label}</h1>
                            <div className="CompactPageContent">
                                {mobileSection === 'code' && editor}
                                {mobileSection === 'preview' && preview}
                                {mobileSection === 'examples' && <ExamplesView examples={examples} onSelect={selectExample} disabled={!sessionReady} />}
                                {mobileSection === 'settings' && <SettingsView preferences={settingsPreferences} renderServerUrl={renderUrl} onChange={updateSettings} />}
                            </div>
                        </section>
                    </div>
                    <nav className="MobileTabs" role="tablist" aria-label="Editor sections">
                        {mobileSections.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={mobileSection === id}
                                onClick={() => setView((current) => ({ ...current, panel: id }))}
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
                            <button type="button" role="tab" aria-selected={sidebar === 'examples'} onClick={() => setView((current) => ({ ...current, sidebar: 'examples' }))}>Examples</button>
                            <button type="button" role="tab" aria-selected={sidebar === 'syntax'} onClick={() => setView((current) => ({ ...current, sidebar: 'syntax' }))}>Syntax</button>
                        </div>
                        {sidebar === 'examples' ? (
                            <div className="SidebarList">
                                {examples.filter((example) => example.diagramType === language).map((example) => (
                                    <button type="button" key={example.id} disabled={!sessionReady} onClick={() => selectExample(example)}>
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
                    <section
                        className="CanvasSplit"
                        style={{ '--source-pane': `${view.splitPercent}%` } as React.CSSProperties}
                    >
                        <div className="Pane">
                            <header><span>Source</span><small>{source === previewSource ? 'Up to date' : 'Editing…'}</small></header>
                            {editor}
                        </div>
                        <button
                            type="button"
                            className="PaneSplitter"
                            role="separator"
                            aria-label="Resize source and preview panes"
                            aria-orientation="vertical"
                            aria-valuemin={20}
                            aria-valuemax={80}
                            aria-valuenow={Math.round(view.splitPercent)}
                            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                            onPointerMove={moveSplitter}
                            onKeyDown={(event) => {
                                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                                event.preventDefault();
                                setView((current) => ({
                                    ...current,
                                    splitPercent: Math.min(80, Math.max(20, current.splitPercent + (event.key === 'ArrowLeft' ? -2 : 2))),
                                }));
                            }}
                        />
                        <div className="Pane PreviewPane">
                            <header><span>Preview</span><small>{renderState.dimensions ? `${renderState.dimensions.width} × ${renderState.dimensions.height}` : 'Live preview'}</small></header>
                            {preview}
                        </div>
                    </section>
                    <aside className="DesktopSettings">
                        <SettingsView preferences={settingsPreferences} renderServerUrl={renderUrl} onChange={updateSettings} />
                    </aside>
                </main>
            )}
        </div>
    );
}

function App() {
    const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences(window.localStorage));
    const [runtime, setRuntime] = useState<{ renderUrl: string; sessionBackendUrl: string | null } | null>(null);

    useEffect(() => {
        let active = true;
        const fallbackRenderUrl = normalizeRenderUrl(__KROKI_ENGINE_URL__ || defaultRenderUrl);
        loadRuntimeConfig().then((outcome) => {
            if (!active) return;
            if (outcome.status === 'invalid') console.error(`[neolesk] ignoring runtime config: ${outcome.reason}`);
            setRuntime({
                renderUrl: outcome.status === 'loaded'
                    ? normalizeRenderUrl(outcome.config.renderServerUrl || outcome.config.krokiEngineUrl || fallbackRenderUrl)
                    : fallbackRenderUrl,
                sessionBackendUrl: outcome.status === 'loaded' ? outcome.config.sessionBackendUrl || null : null,
            });
        });
        return () => { active = false; };
    }, []);

    const updatePreferences = (next: Preferences) => {
        setPreferences(next);
        savePreferences(window.localStorage, next);
    };

    if (!runtime) return <main className="ConsentScreen" aria-label="Loading neolesk" />;

    const consentIsCurrent = preferences.remoteRendering === 'local-only'
        || Boolean(getConsentedRemoteRenderer(
            preferences.remoteRendering,
            preferences.consentedRenderServer,
            runtime.renderUrl,
        ));
    if (!preferences.remoteRendering || !consentIsCurrent) {
        return <ConsentInterstitial renderServerUrl={runtime.renderUrl} onChoose={(remoteRendering) => updatePreferences({
            ...preferences,
            remoteRendering,
            consentedRenderServer: consentServerForChoice(remoteRendering, runtime.renderUrl),
        })} />;
    }

    return (
        <EditorApplication
            preferences={preferences}
            renderUrl={runtime.renderUrl}
            sessionBackendUrl={runtime.sessionBackendUrl}
            onPreferencesChange={updatePreferences}
        />
    );
}

export default App;
