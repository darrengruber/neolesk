import React, { useEffect, useRef } from 'react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch"

import './Render.css'

const imageFiletypes = new Set(['svg', 'png', 'jpeg', 'jpg', 'gif', 'webp']);

const Render = ({ diagramUrl, diagramEditUrl, diagramError, filetype, onDiagramError, height, width, onEditSizeChanged, shouldRedraw }) => {
    const editRef = useRef(null)
    const isImageFiletype = imageFiletypes.has(filetype);

    useEffect(() => {
        if (!editRef.current) {
            return
        }
        const resizeObserver = new ResizeObserver(() => {
            if (onEditSizeChanged) {
                onEditSizeChanged(editRef.current.clientWidth, editRef.current.clientHeight)
            }
        })
        resizeObserver.observe(editRef.current)
        return () => resizeObserver.disconnect()
    }, [onEditSizeChanged])

    return <div className='Render'>
        <div className='RenderDiagramZone' style={{ width: `${width}px` }}>
            {
                diagramError ?
                    <iframe className='RenderImageError' width={width} height={height} title='Error' src={diagramUrl}></iframe> :
                    isImageFiletype ?
                        <TransformWrapper width={width} height='100%' maxScale={100}>
                            {(utils) => {
                                if (shouldRedraw) {
                                    utils.resetTransform()
                                }
                                return <TransformComponent>
                                    <div style={{ width: width, height: height }}>
                                        <img alt='Diagram' className='RenderImage' src={diagramUrl} onError={() => { onDiagramError(diagramUrl) }} style={{ maxWidth: width, maxHeight: height }} />
                                    </div>
                                </TransformComponent>
                            }}
                        </TransformWrapper> :
                        <iframe className='RenderDocument' width={width} height={height} title={`Diagram ${filetype}`} src={diagramUrl}></iframe>
            }
        </div>
        <p className='RenderEditMessage' ref={editRef}><a href={diagramEditUrl}>Edit this diagram.</a></p>
    </div>
}

export default Render;
