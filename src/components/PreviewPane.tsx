import { useCallback, useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import OutputFormatGroup from './OutputFormatGroup';
import { imageFiletypes } from '../utils/format';

const renderCanvasPadding = 18;
const minimumPreviewScale = 0.05;

interface TransformApi {
    zoomIn: () => void;
    zoomOut: () => void;
    setTransform: (positionX: number, positionY: number, scale: number, animationTime?: number) => void;
    resetTransform: () => void;
}

interface PreviewPaneProps {
    diagramUrl: string;
    previewUrl: string;
    diagramEditUrl: string;
    diagramError: boolean;
    filetype: string;
    onDiagramError: (url: string) => void;
    onFiletypeChange: (filetype: string) => void;
    filetypes: string[];
}

const PreviewPane = ({
    diagramUrl,
    previewUrl,
    diagramEditUrl,
    diagramError,
    filetype,
    onDiagramError,
    onFiletypeChange,
    filetypes,
}: PreviewPaneProps): JSX.Element => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const retryTimeoutRef = useRef<number | null>(null);
    const onDiagramErrorRef = useRef(onDiagramError);
    const transformApiRef = useRef<TransformApi | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 960, height: 640 });
    const isImageFiletype = imageFiletypes.has(filetype);
    const [displayedDiagramUrl, setDisplayedDiagramUrl] = useState(previewUrl);
    const [displayedImageBounds, setDisplayedImageBounds] = useState<{ width: number; height: number } | null>(null);
    const [imageLoaded, setImageLoaded] = useState(!isImageFiletype);

    const clearPendingRetry = useCallback(() => {
        if (retryTimeoutRef.current !== null) {
            window.clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
    }, []);

    const fitDiagramToViewport = useCallback(() => {
        if (!transformApiRef.current || !displayedImageBounds) {
            return;
        }

        const contentWidth = displayedImageBounds.width + (renderCanvasPadding * 2);
        const contentHeight = displayedImageBounds.height + (renderCanvasPadding * 2);
        const scaleX = viewportSize.width / contentWidth;
        const scaleY = viewportSize.height / contentHeight;
        const scale = Math.max(minimumPreviewScale, Math.min(scaleX, scaleY, 48));
        const positionX = (viewportSize.width - contentWidth * scale) / 2;
        const positionY = (viewportSize.height - contentHeight * scale) / 2;

        transformApiRef.current.setTransform(positionX, positionY, scale, 0);
    }, [displayedImageBounds, viewportSize.width, viewportSize.height]);

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
        return () => clearPendingRetry();
    }, [clearPendingRetry]);

    useEffect(() => {
        onDiagramErrorRef.current = onDiagramError;
    }, [onDiagramError]);

    useEffect(() => {
        if (!isImageFiletype) {
            setDisplayedDiagramUrl(previewUrl);
            setDisplayedImageBounds(null);
            setImageLoaded(true);
            return;
        }

        if (previewUrl === displayedDiagramUrl && displayedImageBounds) {
            return;
        }

        clearPendingRetry();

        let cancelled = false;
        let attempts = 0;

        const loadImage = () => {
            const preloader = new Image();
            preloader.onload = () => {
                if (cancelled) {
                    return;
                }

                clearPendingRetry();
                setDisplayedDiagramUrl(previewUrl);
                setDisplayedImageBounds({
                    width: preloader.naturalWidth || viewportSize.width,
                    height: preloader.naturalHeight || viewportSize.height,
                });
                setImageLoaded(true);
            };
            preloader.onerror = () => {
                if (cancelled) {
                    return;
                }

                if (attempts < 3) {
                    attempts += 1;
                    retryTimeoutRef.current = window.setTimeout(loadImage, attempts * 300);
                    return;
                }

                onDiagramErrorRef.current(previewUrl);
            };
            preloader.src = previewUrl;
        };

        setImageLoaded(false);
        loadImage();

        return () => {
            cancelled = true;
            clearPendingRetry();
        };
    }, [clearPendingRetry, displayedDiagramUrl, displayedImageBounds, isImageFiletype, previewUrl, viewportSize.height, viewportSize.width]);

    useEffect(() => {
        if (isImageFiletype && displayedImageBounds) {
            fitDiagramToViewport();
        }
    }, [displayedDiagramUrl, displayedImageBounds, fitDiagramToViewport, isImageFiletype, viewportSize.height, viewportSize.width]);

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
                        <button type="button" className="RenderToolbarButton RenderToolbarButtonWide" onClick={fitDiagramToViewport}>
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
                    minScale={minimumPreviewScale}
                    maxScale={48}
                    limitToBounds={false}
                    alignmentAnimation={{ disabled: true }}
                    wheel={{ step: 0.12 }}
                    panning={{ velocityDisabled: true }}
                    doubleClick={{ disabled: true }}
                >
                    {(controls) => {
                        transformApiRef.current = controls;
                        return (
                            <div className="RenderViewport" style={{ height: `${viewportSize.height}px` }}>
                                {diagramError && displayedDiagramUrl === previewUrl ? (
                                    <iframe className="RenderImageError" title="Error" src={previewUrl} />
                                ) : (
                                    <>
                                        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                                            <div
                                                className="RenderCanvas"
                                                style={{
                                                    width: `${(displayedImageBounds?.width || viewportSize.width) + (renderCanvasPadding * 2)}px`,
                                                    height: `${(displayedImageBounds?.height || viewportSize.height) + (renderCanvasPadding * 2)}px`,
                                                    padding: `${renderCanvasPadding}px`,
                                                }}
                                            >
                                                <img
                                                    alt="Diagram"
                                                    className="RenderImage"
                                                    src={displayedDiagramUrl}
                                                    style={{
                                                        width: displayedImageBounds ? `${displayedImageBounds.width}px` : 'auto',
                                                        height: displayedImageBounds ? `${displayedImageBounds.height}px` : 'auto',
                                                    }}
                                                />
                                            </div>
                                        </TransformComponent>
                                        {!imageLoaded || displayedDiagramUrl !== previewUrl ? (
                                            <div className="RenderLoading">
                                                <span className="RenderLoadingDot" />
                                                Rendering
                                            </div>
                                        ) : null}
                                    </>
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

export default PreviewPane;
