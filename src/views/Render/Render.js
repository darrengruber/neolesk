import React, { useEffect, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch"
import OutputFormat from '../OutputFormat';

import './Render.css'

const imageFiletypes = new Set(['svg', 'png', 'jpeg', 'jpg', 'gif', 'webp']);

const Render = ({ diagramUrl, diagramEditUrl, diagramError, filetype, onDiagramError, onEditSizeChanged, shouldRedraw }) => {
    const panelRef = useRef(null)
    const toolbarRef = useRef(null)
    const transformApiRef = useRef(null)
    const [viewportSize, setViewportSize] = useState({ width: 960, height: 640 })
    const [imageBounds, setImageBounds] = useState(null)
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
        if (!panelRef.current) {
            return () => { };
        }

        const updateSize = () => {
            if (!panelRef.current) {
                return;
            }

            const toolbarHeight = toolbarRef.current ? toolbarRef.current.offsetHeight : 0;
            const nextWidth = Math.max(320, Math.floor(panelRef.current.clientWidth));
            const nextHeight = Math.max(240, Math.floor(panelRef.current.clientHeight - toolbarHeight));

            setViewportSize((current) => {
                if (current.width === nextWidth && current.height === nextHeight) {
                    return current;
                }
                return { width: nextWidth, height: nextHeight };
            });

            if (onEditSizeChanged) {
                onEditSizeChanged(nextWidth, 0);
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(() => updateSize())
        resizeObserver.observe(panelRef.current)
        if (toolbarRef.current) {
            resizeObserver.observe(toolbarRef.current)
        }

        return () => resizeObserver.disconnect()
    }, [onEditSizeChanged])

    useEffect(() => {
        setImageBounds(null);
    }, [diagramUrl]);

    useEffect(() => {
        if (isImageFiletype && imageBounds) {
            fitDiagramToViewport();
        }
    }, [diagramUrl, imageBounds, isImageFiletype, viewportSize.width, viewportSize.height])

    const renderToolbar = (controls) => <div className='RenderToolbar' ref={toolbarRef}>
        <div className='RenderToolbarBadge'>
            <OutputFormat />
        </div>
        {
            controls ? <>
                <button type='button' className='RenderToolbarButton' onClick={() => controls.zoomOut()}>-</button>
                <button type='button' className='RenderToolbarButton' onClick={() => controls.zoomIn()}>+</button>
                <button type='button' className='RenderToolbarButton RenderToolbarButtonWide' onClick={() => controls.resetTransform()}>Reset</button>
            </> : null
        }
        <a className='RenderToolbarLink' href={diagramUrl} target='_blank' rel='noreferrer'>Open</a>
        <a className='RenderToolbarLink RenderToolbarLinkAccent' href={diagramEditUrl} target='_blank' rel='noreferrer'>Edit</a>
    </div>

    const renderImageSurface = () => <TransformWrapper
        minScale={0.25}
        maxScale={48}
        centerOnInit={true}
        centerZoomedOut={true}
        wheel={{ step: 0.12 }}
        pinch={{ step: 4 }}
        panning={{ velocityDisabled: true }}
        doubleClick={{ disabled: true }}
    >
        {(controls) => {
            transformApiRef.current = controls;

            return <>
                {renderToolbar(controls)}
                <div className='RenderViewport' style={{ height: `${viewportSize.height}px` }}>
                    {
                        diagramError ?
                            <iframe className='RenderImageError' title='Error' src={diagramUrl}></iframe> :
                            <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
                                <div className='RenderCanvas' style={{ width: `${viewportSize.width}px`, minHeight: `${viewportSize.height}px` }}>
                                    <img
                                        alt='Diagram'
                                        className='RenderImage'
                                        src={diagramUrl}
                                        onError={() => { onDiagramError(diagramUrl) }}
                                        onLoad={(event) => {
                                            const target = event.currentTarget;
                                            const width = target.naturalWidth || target.clientWidth || viewportSize.width;
                                            const height = target.naturalHeight || target.clientHeight || viewportSize.height;
                                            setImageBounds({ width, height });
                                        }}
                                        style={{ maxWidth: `${viewportSize.width}px`, maxHeight: `${viewportSize.height}px` }}
                                    />
                                </div>
                            </TransformComponent>
                    }
                </div>
            </>
        }}
    </TransformWrapper>

    const renderDocumentSurface = () => <>
        {renderToolbar(null)}
        <div className='RenderViewport' style={{ height: `${viewportSize.height}px` }}>
            <iframe className='RenderDocument' title={`Diagram ${filetype}`} src={diagramUrl}></iframe>
        </div>
    </>

    return <div className='Render' ref={panelRef}>
        {isImageFiletype ? renderImageSurface() : renderDocumentSurface()}
    </div>
}

export default Render;
