import { useEffect, useRef, useState, type RefObject } from 'react';
import { ScanEye, ZoomIn, ZoomOut } from 'lucide-react';
import type { DiagramRenderState } from '../hooks/useDiagramRender';
import { Spinner, iconProps } from '../ui/controls';
import {
    formatZoom,
    pinchZoom,
    stepZoom,
    ZOOM_MAX,
    ZOOM_MIN,
    zoomValueText,
    type LayoutClass,
} from '../ui/model';

/** Space the fitted diagram keeps from the canvas edge on touch layouts. */
const FIT_INSET = 32;

interface Pinch {
    startZoom: number;
    startDistance: number;
}

const distanceBetween = (points: Map<number, { x: number; y: number }>) => {
    const [first, second] = Array.from(points.values());
    return Math.hypot(first.x - second.x, first.y - second.y);
};

const useElementSize = (ref: RefObject<HTMLElement | null>, enabled: boolean) => {
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || !enabled) return undefined;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [enabled, ref]);
    return size;
};

/**
 * The rendered diagram. At wide width it keeps the exact geometry that the
 * example corpus screenshots (ADR 0012). On touch layouts the diagram is sized
 * explicitly so a zoomed diagram can be panned in every direction and pinched.
 */
export function PreviewCanvas({
    layout,
    previewRef,
    renderState,
    zoom,
    emptySource,
    onZoomChange,
    onScrollChange,
    onAllowRemote,
    renderServerHost,
    agentDrawing = false,
}: {
    layout: LayoutClass;
    previewRef: RefObject<HTMLElement | null>;
    renderState: DiagramRenderState;
    zoom: number;
    emptySource: boolean;
    onZoomChange: (zoom: number) => void;
    onScrollChange: (position: { previewScrollTop: number; previewScrollLeft: number }) => void;
    onAllowRemote: () => void;
    /** Consent is for a specific render server, so the button names it. */
    renderServerHost: string;
    /**
     * The latest change came from an agent in a live session. Its intermediate
     * source may not render yet; show only valid diagrams until it does.
     */
    agentDrawing?: boolean;
}) {
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const pinch = useRef<Pinch | null>(null);
    const [pinching, setPinching] = useState(false);
    const sized = layout !== 'wide' && Boolean(renderState.dimensions);
    const size = useElementSize(previewRef, layout !== 'wide');

    const fitted = (() => {
        if (!sized || !size || !renderState.dimensions) return null;
        const { width, height } = renderState.dimensions;
        const fit = Math.min(1, (size.width - FIT_INSET) / width, (size.height - FIT_INSET) / height);
        const scale = Math.max(0.05, fit) * zoom;
        return { width: Math.round(width * scale), height: Math.round(height * scale) };
    })();

    const endPointer = (pointerId: number) => {
        pointers.current.delete(pointerId);
        if (pointers.current.size < 2 && pinch.current) {
            pinch.current = null;
            setPinching(false);
        }
    };

    const failed = Boolean(renderState.error) && !renderState.loading;
    // While the agent draws, a failed intermediate render keeps the last valid diagram.
    const holdingForAgent = agentDrawing && failed;
    const showImage = Boolean(renderState.blobUrl) && !emptySource && (!failed || holdingForAgent);

    return (
        <section
            ref={previewRef}
            className="PreviewPanel"
            aria-label="Diagram preview"
            data-zoom={zoom}
            data-sizing={fitted ? 'fit' : undefined}
            data-gesture={pinching || undefined}
            onScroll={(event) => onScrollChange({
                previewScrollTop: event.currentTarget.scrollTop,
                previewScrollLeft: event.currentTarget.scrollLeft,
            })}
            onPointerDown={(event) => {
                if (event.pointerType !== 'touch') return;
                pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (pointers.current.size === 2) {
                    pinch.current = { startZoom: zoom, startDistance: distanceBetween(pointers.current) };
                    setPinching(true);
                }
            }}
            onPointerMove={(event) => {
                if (!pointers.current.has(event.pointerId)) return;
                pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (pinch.current && pointers.current.size === 2) {
                    onZoomChange(pinchZoom(pinch.current.startZoom, pinch.current.startDistance, distanceBetween(pointers.current)));
                }
            }}
            onPointerUp={(event) => endPointer(event.pointerId)}
            onPointerCancel={(event) => endPointer(event.pointerId)}
        >
            <div className="PreviewZoom" role="group" aria-label="Preview zoom controls">
                <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => onZoomChange(stepZoom(zoom, -1))}>
                    <ZoomOut {...iconProps} />
                </button>
                <button
                    type="button"
                    className="ZoomValue"
                    aria-label={`Reset zoom, now ${zoomValueText(zoom)}`}
                    onClick={() => onZoomChange(1)}
                >
                    {formatZoom(zoom)}
                </button>
                <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => onZoomChange(stepZoom(zoom, 1))}>
                    <ZoomIn {...iconProps} />
                </button>
                <span className="VisuallyHidden" aria-live="polite">{zoomValueText(zoom)}</span>
            </div>
            {emptySource && (
                <div className="PreviewState EmptyState">
                    <ScanEye {...iconProps} />
                    <p className="EmptyTitle">No Diagram Yet</p>
                    <p className="EmptyDetail">Write diagram source in the editor to see it here.</p>
                </div>
            )}
            {!emptySource && renderState.loading && !renderState.blobUrl && (
                <div className="PreviewState"><Spinner label="Rendering…" /></div>
            )}
            {showImage && renderState.blobUrl && (
                <img
                    src={renderState.blobUrl}
                    alt="Rendered diagram"
                    style={fitted
                        ? { width: `${fitted.width}px`, height: `${fitted.height}px` }
                        : { transform: `scale(${zoom})` }}
                />
            )}
            {holdingForAgent && !emptySource && !renderState.blobUrl && (
                <div className="PreviewState"><Spinner label="Agent is still drawing" /></div>
            )}
            {holdingForAgent && !emptySource && renderState.blobUrl && (
                <div className="AgentDrawing" role="status">Agent is still drawing</div>
            )}
            {!emptySource && failed && !holdingForAgent && (
                <div className="PreviewError" role="alert">
                    <strong>{renderState.consentRequired ? 'Remote Rendering Is Off' : 'Can’t Render This Diagram'}</strong>
                    <p>{renderState.error?.message}</p>
                    {renderState.consentRequired && (
                        <button type="button" onClick={onAllowRemote}>Allow Rendering at {renderServerHost}</button>
                    )}
                </div>
            )}
        </section>
    );
}
