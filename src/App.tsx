import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, Link2, Share, Users, X } from 'lucide-react';
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
import { useVisualViewport } from './hooks/useVisualViewport';
import { useWindowWidth } from './hooks/useWindowWidth';
import { decode } from './kroki/coder';
import {
    consentServerForChoice,
    getConsentedRemoteRenderer,
    loadPreferences,
    savePreferences,
    type Preferences,
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
import { iconProps } from './ui/controls';
import {
    hostOf,
    layoutForWidth,
    presenceText,
    tabsForLayout,
    type Panel,
    type Presence,
} from './ui/model';
import { ExampleThumbnail } from './ui/ExampleThumbnail';
import { LargeTitlePage, NavigationBar, panelId, TabBar, tabId } from './ui/Navigation';
import { buildExamples } from './utils/examples';
import { ConsentScreen, LoadingScreen } from './views/ConsentScreen';
import { ExamplesView } from './views/ExamplesView';
import { LanguageSheet } from './views/LanguageSheet';
import { PreviewCanvas } from './views/PreviewCanvas';
import { SettingsView } from './views/SettingsView';
import { ShareSheet } from './views/ShareSheet';
import './styles.css';

interface ParticipantViewModel {
    panel: Panel;
    sidebar: 'examples' | 'syntax';
    theme: Preferences['appearance'];
    splitPercent: number;
    zoom: number;
    scrollTop: number;
    scrollLeft: number;
    previewScrollTop: number;
    previewScrollLeft: number;
}

interface StatusMessage {
    text: string;
    /** A confirmation clears itself; anything a person must act on stays until dismissed. */
    transient: boolean;
}

const PANEL_KEY = 'neolesk:panel';
const panels = new Set<Panel>(['code', 'preview', 'examples', 'settings']);
const TRANSIENT_STATUS_MS = 4000;

const currentLocation = () => `${window.location.pathname}${window.location.hash}`;

/** Remember the section together with the URL it belongs to. */
const rememberPanel = (panel: Panel) => {
    try {
        window.sessionStorage.setItem(PANEL_KEY, JSON.stringify({ panel, location: currentLocation() }));
    } catch {
        // Remembering the section is a convenience only.
    }
};

/**
 * A reload keeps the section a person was in. A snapshot link or session link
 * that was just opened, in a new tab or this one, starts on its preview.
 */
const initialPanel = (): Panel => {
    try {
        const stored = JSON.parse(window.sessionStorage.getItem(PANEL_KEY) || 'null') as { panel?: Panel; location?: string } | null;
        if (stored?.panel && panels.has(stored.panel) && stored.location === currentLocation()) return stored.panel;
    } catch {
        // Storage can be unavailable in private browsing; the default is fine.
    }
    return window.location.hash.length > 1 || getSessionIdFromPath(window.location.pathname) ? 'preview' : 'code';
};

const getSystemAppearance = (): 'light' | 'dark' => (
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
);

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

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
    const [presence, setPresence] = useState<Presence>('offline');
    const [agentPresence, setAgentPresence] = useState<Presence>('offline');
    const [agentActivity, setAgentActivity] = useState<string | null>(null);
    const previewRef = useRef<HTMLElement | null>(null);
    const [view, setView] = useState<ParticipantViewModel>(() => ({
        panel: initialPanel(),
        sidebar: 'examples',
        theme: preferences.appearance,
        splitPercent: 50,
        zoom: 1,
        scrollTop: 0,
        scrollLeft: 0,
        previewScrollTop: 0,
        previewScrollLeft: 0,
    }));
    const [languageOpen, setLanguageOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [editorFocused, setEditorFocused] = useState(false);
    const [viewHydrated, setViewHydrated] = useState(false);
    const [status, setStatus] = useState<StatusMessage | null>(null);
    const width = useWindowWidth();
    const layout = layoutForWidth(width);
    const { keyboardOpen } = useVisualViewport();
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
    const emptySource = previewSource.trim() === '';

    const announce = (text: string, transient = false) => setStatus({ text, transient });

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

    useEffect(() => rememberPanel(view.panel), [view.panel]);

    useEffect(() => {
        if (!status?.transient) return undefined;
        const timeout = setTimeout(() => setStatus((current) => (current === status ? null : current)), TRANSIENT_STATUS_MS);
        return () => clearTimeout(timeout);
    }, [status]);

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
            announce(message);
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
                onError: (message) => announce(message),
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
        rememberPanel(view.panel);
        // Keep the remembered URL current as edits rewrite the hash; the panel effect covers panel changes.
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
            announce('The live session is still connecting');
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
        // On a phone, show the example itself; the source is one tab away.
        setView((current) => ({ ...current, panel: layout === 'compact' ? 'preview' : 'code' }));
    };

    const copyText = async (text: string, confirmation: string) => {
        try {
            if (!navigator.clipboard) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(text);
            announce(confirmation, true);
        } catch {
            announce('Can’t copy to the clipboard in this browser.');
        }
    };

    const snapshotUrl = () => buildDiagramState({
        baseUrl,
        diagramType: language,
        diagramText: source,
        filetype: 'svg',
        renderUrl,
    }).editUrl;

    const copySnapshot = () => copyText(snapshotUrl(), 'Snapshot link copied');

    const shareSnapshot = async () => {
        try {
            await navigator.share({ title: `${diagramTypes[language]?.name || language} diagram`, url: snapshotUrl() });
        } catch (error) {
            if (!isAbort(error)) announce('Can’t open the share sheet. Copy the link instead.');
        }
    };

    const agentUrl = () => activeSession?.mcpUrl || `${window.location.origin}/mcp/${sessionId}`;
    const sessionUrl = () => activeSession?.sessionUrl || `${window.location.origin}/s/${sessionId}`;

    const startSession = async () => {
        if (!sessionBackendUrl) return;
        try {
            const session = await createSession(sessionBackendUrl, { language, source });
            setActiveSession(session);
            setSessionId(session.id);
            const path = new URL(session.sessionUrl).pathname;
            window.history.pushState(null, '', path);
            announce('Live session started', true);
        } catch (error) {
            announce(error instanceof Error ? error.message : String(error));
        }
    };

    const saveFile = async (blob: Blob, filename: string) => {
        // On touch devices the system share sheet offers Save to Files and
        // Photos, which a download link does not.
        const file = new File([blob], filename, { type: blob.type });
        if (layout !== 'wide' && navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: filename });
                return true;
            } catch (error) {
                if (isAbort(error)) return false;
                // Sharing needs a recent tap. After a slow server export the
                // browser refuses, and the file downloads instead.
            }
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        // WebKit can cancel a download whose URL is revoked in the same task.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return true;
    };

    const download = async (format: ExportFormat) => {
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
            if (await saveFile(blob, `diagram.${format}`)) announce(`${format.toUpperCase()} exported`, true);
        } catch (error) {
            announce(error instanceof Error ? error.message : String(error));
        }
    };

    // Wait for the sheet to close before the browser's print dialog takes over.
    const printDiagram = () => window.setTimeout(() => window.print(), 0);

    const setZoom = (zoom: number) => setView((current) => ({ ...current, zoom }));
    const selectPanel = (panel: Panel) => setView((current) => ({ ...current, panel }));
    const allowRemote = () => onPreferencesChange({
        ...preferences,
        remoteRendering: 'neolesk',
        consentedRenderServer: consentServerForChoice('neolesk', renderUrl),
    });

    const editor = (
        <section
            className="EditorPanel"
            aria-label="Code editor"
            onFocus={() => setEditorFocused(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditorFocused(false);
            }}
        >
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
        <PreviewCanvas
            layout={layout}
            previewRef={previewRef}
            renderState={renderState}
            zoom={view.zoom}
            emptySource={emptySource}
            onZoomChange={setZoom}
            onScrollChange={(position) => setView((current) => ({ ...current, ...position }))}
            onAllowRemote={allowRemote}
            renderServerHost={hostOf(renderUrl)}
        />
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

    const languageName = diagramTypes[language]?.name || language;
    const renderingLabel = renderState.loading && !emptySource ? 'Rendering…' : provenanceLabel;

    const split = (
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
                <header>
                    <span>Preview</span>
                    <small>{renderState.loading && !emptySource ? 'Rendering…' : renderState.dimensions ? `${renderState.dimensions.width} × ${renderState.dimensions.height}` : 'Live preview'}</small>
                </header>
                {preview}
            </div>
        </section>
    );

    // The live region stays mounted so screen readers announce each new message.
    const statusBanner = (
        <div className="StatusRegion" role="status">
            {status && (
                <div className={layout === 'wide' ? 'StatusMessage' : 'Toast'}>
                    <span>{status.text}</span>
                    <button type="button" className="StatusDismiss" aria-label="Dismiss" onClick={() => setStatus(null)}>
                        <X {...iconProps} />
                    </button>
                </div>
            )}
        </div>
    );

    const sheets = (
        <>
            <LanguageSheet
                open={languageOpen}
                language={language}
                disabled={!sessionReady}
                onSelect={changeLanguage}
                onClose={() => setLanguageOpen(false)}
            />
            <ShareSheet
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                canShareLink={typeof navigator.share === 'function'}
                onCopySnapshot={copySnapshot}
                onShareSnapshot={shareSnapshot}
                session={{
                    available: Boolean(sessionBackendUrl),
                    active: Boolean(sessionId),
                    presence,
                    agentPresence,
                    agentActivity,
                    onStart: startSession,
                    onCopyAgentUrl: () => copyText(agentUrl(), 'Agent URL copied'),
                    onCopySessionLink: () => copyText(sessionUrl(), 'Session link copied'),
                }}
                hasRenderServer={Boolean(remote)}
                hasDiagram={Boolean(renderState.svgText)}
                onExport={download}
                onPrint={printDiagram}
            />
        </>
    );

    // Printing shows only this copy of the diagram, whichever tab is open.
    const dimensions = renderState.dimensions;
    const printable = (
        <div
            className="PrintDiagram"
            data-orientation={dimensions && dimensions.width > dimensions.height ? 'landscape' : 'portrait'}
        >
            {renderState.blobUrl && !emptySource && !renderState.error
                ? <img src={renderState.blobUrl} alt={`${languageName} diagram`} />
                : <p>Nothing to print yet: this diagram has not rendered.</p>}
        </div>
    );

    const appAttributes = {
        className: 'App',
        'data-appearance': view.theme,
        'data-layout': layout,
        'data-keyboard': keyboardOpen ? 'open' : undefined,
        style: { '--window-opacity': String(preferences.transparency) } as React.CSSProperties,
    };

    const liquidGlassFilter = (
        <svg className="LiquidGlassFilter" aria-hidden="true">
            <filter id="neolesk-liquid-glass" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" seed="8" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="B" />
            </filter>
        </svg>
    );

    if (layout !== 'wide') {
        const tabs = tabsForLayout(layout);
        const selectedTab = tabs.find((tab) => tab.panels.includes(view.panel)) || tabs[0];
        const titleButton = (
            <button
                type="button"
                className="TitleMenuButton"
                aria-haspopup="dialog"
                aria-label={`Diagram language: ${languageName}`}
                aria-describedby="rendering-subtitle"
                onClick={() => setLanguageOpen(true)}
            >
                <span className="TitleMenuName">{languageName}<ChevronDown {...iconProps} /></span>
                <span className="TitleMenuSubtitle" id="rendering-subtitle">
                    <span className="ProvenanceDot" data-remote={renderState.provenance?.kind === 'remote' || undefined} aria-hidden="true" />
                    {renderingLabel}
                </span>
            </button>
        );
        const sessionCapsule = sessionId ? (
            <button
                type="button"
                className="SessionCapsule"
                aria-label={`Live session. ${presenceText('person', presence)}. ${presenceText('agent', agentPresence)}.`}
                onClick={() => setShareOpen(true)}
            >
                <span className="PresenceDot" data-presence={presence} aria-hidden="true" />Live
            </button>
        ) : null;
        const shareButton = (
            <button type="button" className="IconButton" aria-label="Share and export" onClick={() => setShareOpen(true)}>
                <Share {...iconProps} />
            </button>
        );
        const trailing = editorFocused && keyboardOpen ? (
            <button
                type="button"
                className="TextButton TextButtonBold"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
            >
                Done
            </button>
        ) : shareButton;
        const editorBar = <NavigationBar leading={sessionCapsule} center={titleButton} trailing={trailing} />;

        return (
            <div {...appAttributes}>
                {liquidGlassFilter}
                <main className="CompactWorkspace">
                    <section
                        className="CompactPage"
                        key={selectedTab.id}
                        role="tabpanel"
                        id={panelId(selectedTab.id)}
                        aria-labelledby={tabId(selectedTab.id)}
                        data-page={selectedTab.id}
                    >
                        {selectedTab.id === 'code' && (
                            <>
                                {editorBar}
                                <h1 className="VisuallyHidden">{selectedTab.label}</h1>
                                {layout === 'compact' ? editor : split}
                            </>
                        )}
                        {selectedTab.id === 'preview' && (
                            <>
                                {editorBar}
                                <h1 className="VisuallyHidden">Preview</h1>
                                {preview}
                            </>
                        )}
                        {selectedTab.id === 'examples' && (
                            <ExamplesView
                                examples={examples}
                                onSelect={selectExample}
                                disabled={!sessionReady}
                                currentLanguage={language}
                            />
                        )}
                        {selectedTab.id === 'settings' && (
                            <LargeTitlePage title="Settings" titleId="settings-title">
                                <SettingsView
                                    preferences={settingsPreferences}
                                    renderServerUrl={renderUrl}
                                    sessionsAvailable={Boolean(sessionBackendUrl)}
                                    onChange={updateSettings}
                                />
                            </LargeTitlePage>
                        )}
                    </section>
                    <TabBar tabs={tabs} selected={view.panel} onSelect={selectPanel} />
                </main>
                {statusBanner}
                {sheets}
                {printable}
            </div>
        );
    }

    return (
        <div {...appAttributes}>
            {liquidGlassFilter}
            <header className="TopBar">
                <a className="Brand" href="/" aria-label="neolesk home"><span>neo</span>lesk</a>
                <div className="DocumentControls">
                    <button
                        type="button"
                        className="LanguagePicker"
                        aria-haspopup="dialog"
                        aria-label={`Diagram language: ${languageName}`}
                        onClick={() => setLanguageOpen(true)}
                    >
                        <span>{languageName}</span><ChevronDown {...iconProps} />
                    </button>
                    <span className={`Provenance ${renderState.provenance?.kind === 'remote' ? 'remote' : ''}`}>
                        <span aria-hidden="true" />{provenanceLabel}
                    </span>
                </div>
                <div className="TopActions">
                    <button type="button" className="ToolbarButton" onClick={copySnapshot}><Link2 {...iconProps} /><span>Copy snapshot</span></button>
                    <button type="button" className="ToolbarButton" disabled={!sessionBackendUrl || Boolean(sessionId)} onClick={startSession}><Users {...iconProps} /><span>New session</span></button>
                    <button type="button" className="ToolbarButton Primary" aria-haspopup="dialog" onClick={() => setShareOpen(true)}>
                        <Download {...iconProps} /><span>Export</span>
                    </button>
                </div>
            </header>

            {!sessionBackendUrl && <div className="DeploymentNotice">Sessions unavailable in this deployment</div>}
            {sessionId && (
                <div className="SessionNotice">
                    <span><span className="PresenceDot" data-presence={presence} aria-hidden="true" />Live session</span>
                    <span><span className="PresenceDot" data-presence={agentPresence} aria-hidden="true" />{presenceText('agent', agentPresence)}</span>
                    {agentActivity && <span className="AgentActivity">{agentActivity}</span>}
                    <button type="button" onClick={() => copyText(agentUrl(), 'Agent URL copied')}>Copy agent URL</button>
                </div>
            )}
            {statusBanner}

            <main className="DesktopWorkspace">
                <aside className="Sidebar" aria-label="Reference">
                    <div className="SidebarSwitcher" role="tablist" aria-label="Reference browser">
                        <button type="button" role="tab" aria-selected={sidebar === 'examples'} onClick={() => setView((current) => ({ ...current, sidebar: 'examples' }))}>Examples</button>
                        <button type="button" role="tab" aria-selected={sidebar === 'syntax'} onClick={() => setView((current) => ({ ...current, sidebar: 'syntax' }))}>Syntax</button>
                    </div>
                    {sidebar === 'examples' ? (
                        <div className="SidebarList">
                            {examples.filter((example) => example.diagramType === language).map((example) => (
                                <button type="button" key={example.id} disabled={!sessionReady} onClick={() => selectExample(example)}>
                                    <ExampleThumbnail example={example} size="row" />
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
                {split}
                <aside className="DesktopSettings" aria-labelledby="desktop-settings-title">
                    <h2 id="desktop-settings-title" className="SidebarTitle">Settings</h2>
                    <SettingsView
                        preferences={settingsPreferences}
                        renderServerUrl={renderUrl}
                        sessionsAvailable={Boolean(sessionBackendUrl)}
                        onChange={updateSettings}
                    />
                </aside>
            </main>
            {sheets}
            {printable}
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

    if (!runtime) return <LoadingScreen />;

    const consentIsCurrent = preferences.remoteRendering === 'local-only'
        || Boolean(getConsentedRemoteRenderer(
            preferences.remoteRendering,
            preferences.consentedRenderServer,
            runtime.renderUrl,
        ));
    if (!preferences.remoteRendering || !consentIsCurrent) {
        return <ConsentScreen renderServerUrl={runtime.renderUrl} onChoose={(remoteRendering) => updatePreferences({
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
