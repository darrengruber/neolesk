import { useCallback, useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import DownloadDropdown from './DownloadDropdown';
import CopyDropdown from './CopyDropdown';
import type { SvgFetchResult } from '../hooks/useSvgFetch';
import { downloadBlob, downloadSvg, exportBlob, exportPdf, printScale, svgToCanvas } from '../utils/svgExport';
import type { DiagramState } from '../types';

const renderCanvasPadding = 18;
const minimumPreviewScale = 0.05;

interface TransformApi {
    zoomIn: () => void;
    zoomOut: () => void;
    setTransform: (positionX: number, positionY: number, scale: number, animationTime?: number) => void;
    resetTransform: () => void;
}

interface PreviewPaneProps {
    svg: SvgFetchResult;
    diagramType: string;
    filetypes: string[];
    previewState: DiagramState;
    editorValue: string;
    renderUrl: string;
    defaultRenderUrl: string;
    onRenderUrlChange: (url: string) => void;
}

const PreviewPane = ({
    svg,
    diagramType,
    filetypes,
    previewState,
    editorValue,
    renderUrl,
    defaultRenderUrl,
    onRenderUrlChange,
}: PreviewPaneProps): JSX.Element => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const transformApiRef = useRef<TransformApi | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 960, height: 640 });
    const [downloading, setDownloading] = useState(false);

    const dimensions = svg.dimensions;

    const fitDiagramToViewport = useCallback(() => {
        if (!transformApiRef.current || !dimensions) {
            return;
        }

        const contentWidth = dimensions.width + (renderCanvasPadding * 2);
        const contentHeight = dimensions.height + (renderCanvasPadding * 2);
        const scaleX = viewportSize.width / contentWidth;
        const scaleY = viewportSize.height / contentHeight;
        const scale = Math.max(minimumPreviewScale, Math.min(scaleX, scaleY, 48));
        const positionX = (viewportSize.width - contentWidth * scale) / 2;
        const positionY = (viewportSize.height - contentHeight * scale) / 2;

        transformApiRef.current.setTransform(positionX, positionY, scale, 0);
    }, [dimensions, viewportSize.width, viewportSize.height]);

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
        if (dimensions && !svg.loading) {
            fitDiagramToViewport();
        }
    }, [dimensions, svg.loading, fitDiagramToViewport]);

    const handleDownload = useCallback(async (targetFiletype: string) => {
        if (!svg.svgText || !dimensions) return;
        setDownloading(true);

        try {
            const filename = `${diagramType}-diagram`;

            if (targetFiletype === 'svg') {
                downloadSvg(svg.svgText, `${filename}.svg`);
                return;
            }

            if (targetFiletype === 'pdf') {
                const blob = await exportPdf(svg.svgText, dimensions.width, dimensions.height);
                downloadBlob(blob, `${filename}.pdf`);
                return;
            }

            const scale = printScale(dimensions.width, dimensions.height);
            const canvas = await svgToCanvas(svg.svgText, dimensions.width, dimensions.height, scale);
            const format = targetFiletype === 'jpeg' ? 'image/jpeg' : 'image/png';
            const quality = targetFiletype === 'jpeg' ? 0.92 : undefined;
            const blob = await exportBlob(canvas, format as 'image/png' | 'image/jpeg', quality);
            downloadBlob(blob, `${filename}.${targetFiletype}`);
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            setDownloading(false);
        }
    }, [svg.svgText, dimensions, diagramType]);

    return (
        <div className="Render" ref={panelRef}>
            <div className="RenderToolbar" ref={toolbarRef}>
                <div className="RenderToolbarBadge">
                    <button type="button" className="RenderToolbarButton" onClick={() => transformApiRef.current?.zoomOut()}>
                        -
                    </button>
                    <button type="button" className="RenderToolbarButton" onClick={() => transformApiRef.current?.zoomIn()}>
                        +
                    </button>
                    <button type="button" className="RenderToolbarButton RenderToolbarButtonWide" onClick={fitDiagramToViewport}>
                        Fit
                    </button>
                </div>
                <DownloadDropdown
                    filetypes={filetypes}
                    disabled={downloading || svg.loading || !!svg.error}
                    downloading={downloading}
                    onDownload={handleDownload}
                />
                <CopyDropdown
                    previewState={previewState}
                    editorValue={editorValue}
                    renderUrl={renderUrl}
                    defaultRenderUrl={defaultRenderUrl}
                    onRenderUrlChange={onRenderUrlChange}
                />
            </div>
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
                            {svg.error ? (
                                <div className="RenderError">
                                    <div className="RenderErrorMessage code">{svg.error.message}</div>
                                </div>
                            ) : (
                                <>
                                    <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                                        <div
                                            className="RenderCanvas"
                                            style={{
                                                width: `${(dimensions?.width || viewportSize.width) + (renderCanvasPadding * 2)}px`,
                                                height: `${(dimensions?.height || viewportSize.height) + (renderCanvasPadding * 2)}px`,
                                                padding: `${renderCanvasPadding}px`,
                                            }}
                                        >
                                            {svg.blobUrl ? (
                                                <img
                                                    alt="Diagram"
                                                    className="RenderImage"
                                                    src={svg.blobUrl}
                                                    style={{
                                                        width: dimensions ? `${dimensions.width}px` : 'auto',
                                                        height: dimensions ? `${dimensions.height}px` : 'auto',
                                                    }}
                                                />
                                            ) : null}
                                        </div>
                                    </TransformComponent>
                                    {svg.loading ? (
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
        </div>
    );
};

export default PreviewPane;
