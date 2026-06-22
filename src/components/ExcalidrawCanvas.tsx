import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import LoadingOverlay from './LoadingOverlay';

const Excalidraw = lazy(() =>
    import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
);

interface ExcalidrawCanvasProps {
    value: string;
    onChange: (value: string | undefined) => void;
    isCompact: boolean;
    viewMode: 'canvas' | 'json';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;

function parseScene(json: string) {
    try {
        const scene = JSON.parse(json);
        return {
            elements: scene.elements || [],
            appState: scene.appState || {},
            files: scene.files || {},
        };
    } catch {
        return { elements: [], appState: {}, files: {} };
    }
}

function serializeScene(
    elements: readonly Record<string, unknown>[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
): string {
    return JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements,
        appState: {
            viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
        },
        files,
    }, null, 2);
}

function ExcalidrawCanvas({ value, onChange, isCompact, viewMode }: ExcalidrawCanvasProps): JSX.Element {
    const [locked, setLocked] = useState(true);
    const [api, setApi] = useState<ExcalidrawAPI>(null);
    const debounceRef = useRef<number | null>(null);
    const lastValueRef = useRef(value);
    const suppressOnChangeRef = useRef(false);
    const filesRef = useRef<Record<string, unknown>>({});

    // Auto-unlock when scene is empty
    useEffect(() => {
        const scene = parseScene(value);
        if (scene.elements.length === 0) {
            setLocked(false);
        }
    }, []);

    // Inbound sync: when value changes externally, update the scene
    useEffect(() => {
        if (!api || value === lastValueRef.current) return;
        lastValueRef.current = value;

        const scene = parseScene(value);
        filesRef.current = scene.files;
        suppressOnChangeRef.current = true;
        api.updateScene({
            elements: scene.elements,
            appState: scene.appState,
        });
        requestAnimationFrame(() => {
            suppressOnChangeRef.current = false;
        });
    }, [api, value]);

    // Using `any` to avoid strict type mismatch with Excalidraw's AppState interface
    // which doesn't have an index signature but is structurally compatible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleChange = useCallback(
        (elements: readonly any[], appState: any) => {
            if (suppressOnChangeRef.current) return;

            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current);
            }

            debounceRef.current = window.setTimeout(() => {
                const json = serializeScene(elements, appState, filesRef.current);
                lastValueRef.current = json;
                onChange(json);
                debounceRef.current = null;
            }, 300);
        },
        [onChange],
    );

    useEffect(() => {
        return () => {
            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current);
            }
        };
    }, []);

    if (viewMode !== 'canvas') return <></>;

    const scene = parseScene(value);

    return (
        <div className="ExcalidrawCanvas">
            <Suspense fallback={<LoadingOverlay message="Loading Excalidraw" detail="~2 MB" />}>
                <Excalidraw
                    excalidrawAPI={(excalidrawApi: ExcalidrawAPI) => setApi(excalidrawApi)}
                    initialData={{
                        elements: scene.elements,
                        appState: {
                            ...scene.appState,
                            viewModeEnabled: locked,
                        },
                    }}
                    viewModeEnabled={locked}
                    onChange={handleChange}
                    UIOptions={{
                        canvasActions: isCompact ? {
                            saveToActiveFile: false,
                            loadScene: false,
                            saveAsImage: false,
                            toggleTheme: false,
                        } : {},
                    }}
                    renderTopRightUI={() => (
                        <div className="ExcalidrawTopRightUI">
                            <button
                                type="button"
                                className={`ExcalidrawLockButton${locked ? ' locked' : ''}`}
                                onClick={() => setLocked((v) => !v)}
                                title={locked ? 'Unlock canvas for editing' : 'Lock canvas (read-only)'}
                            >
                                {locked ? (
                                    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
                                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
                                        <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    )}
                />
            </Suspense>
        </div>
    );
}

export default ExcalidrawCanvas;
