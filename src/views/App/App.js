import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types'
import '../fomantic-ui-css/semantic.min.css'
import Editor from '../Editor';
import Render from '../Render';
import CopyZone from '../CopyZone';
import DiagramType from '../DiagramType';
import RenderUrl from '../RenderUrl';
import WindowExampleCards from '../WindowExampleCards';
import WindowExampleDetail from '../WindowExampleDetail';
import WindowImportUrl from '../WindowImportUrl';

import './App.css'
import classNames from 'classnames';

const defaultEditorWidth = 44;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const layoutModes = ['vertical', 'horizontal', 'preview'];

const App = ({ onExamples, onImportUrl, zenMode, onKey, onResize, analytics }) => {
    const [linksOpen, setLinksOpen] = useState(false);
    const [editorWidth, setEditorWidth] = useState(defaultEditorWidth);
    const [isDragging, setIsDragging] = useState(false);
    const [isCompact, setIsCompact] = useState(false);
    const [activeMobileTab, setActiveMobileTab] = useState('source');
    const [layoutMode, setLayoutMode] = useState('vertical');
    const [wrapEnabled, setWrapEnabled] = useState(true);
    const workspaceRef = useRef(null);

    if (!onExamples) {
        onExamples = () => { };
    }
    if (!onImportUrl) {
        onImportUrl = () => { };
    }

    const hasAnalytics = (analytics ? true : false)
    const analyticsJs = hasAnalytics ? (analytics.filter((item) => item.type === 'js')) : []
    const analyticsHtml = hasAnalytics ? (analytics.filter((item) => item.type !== 'js')) : []
    const hasAnalyticsJs = analyticsJs.length > 0
    const hasAnalyticsHtml = analyticsHtml.length > 0

    useEffect(() => {
        const handleResize = () => {
            const { offsetWidth: width, offsetHeight: height } = document.body;
            setIsCompact(width < 980);
            if (onResize) {
                onResize(width, height)
            }
        }

        const handleKeydown = (e) => {
            const { code, key, ctrlKey, shiftKey, altKey, metaKey } = e;
            if (onKey) {
                onKey({ code, key, ctrlKey, shiftKey, altKey, metaKey })
            }
        }

        window.addEventListener('resize', handleResize);
        window.addEventListener('keydown', handleKeydown);
        setTimeout(() => handleResize(), 0);
        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleKeydown);
        }
    }, [onKey, onResize]);


    useEffect(() => {
        if (hasAnalyticsJs) {
            const scripts = analyticsJs.map((analyticsItem)=>{
                const script = document.createElement('script')

                script.async = 'true'
                const content = analyticsItem.content

                if (content.startsWith('http://') || content.startsWith('https://') || content.startsWith('//')) {
                    script.setAttribute('src',content)
                } else {
                    script.textContent = content
                }

                document.head.appendChild(script)
                return script
            })

            return () => {
                for(let script of scripts) {
                    document.head.removeChild(script)
                }
            }
        }
        return () => { }
    }, [analyticsJs, hasAnalyticsJs])

    useEffect(() => {
        if (!isDragging) {
            return () => { };
        }

        const handleMouseMove = (event) => {
            if (!workspaceRef.current) {
                return;
            }

            const rect = workspaceRef.current.getBoundingClientRect();
            const nextWidth = clamp(((event.clientX - rect.left) / rect.width) * 100, 30, 68);
            setEditorWidth(nextWidth);
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
    }, [isDragging]);

    useEffect(() => {
        if (zenMode) {
            setLinksOpen(false);
        }
    }, [zenMode]);

    useEffect(() => {
        if (!isCompact) {
            setActiveMobileTab('source');
        }
    }, [isCompact]);

    useEffect(() => {
        if (layoutMode !== 'vertical' && isDragging) {
            setIsDragging(false);
        }
    }, [isDragging, layoutMode]);

    const showChrome = !zenMode;
    const showEditorPane = !isCompact ? layoutMode !== 'preview' : activeMobileTab === 'source';
    const showPreviewPane = !isCompact ? true : activeMobileTab === 'preview';
    const mobileTabBar = isCompact ? <div className='WorkspaceMobileTabs'>
        <div className='WorkspaceMobileTabGroup'>
            <button
                type='button'
                className={classNames('WorkspaceMobileTab', { active: activeMobileTab === 'source' })}
                onClick={() => setActiveMobileTab('source')}
            >
                Code
            </button>
            <button
                type='button'
                className={classNames('WorkspaceMobileTab', { active: activeMobileTab === 'preview' })}
                onClick={() => setActiveMobileTab('preview')}
            >
                Preview
            </button>
        </div>
        <button
            type='button'
            className={classNames('EditorWrapButton', 'EditorWrapButtonCompact', { active: wrapEnabled })}
            onClick={() => setWrapEnabled((value) => !value)}
        >
            Wrap
        </button>
    </div> : null;

    return <div className={classNames({ zenMode, App: true })}>
        {
            showChrome ? <header className='AppToolbar'>
                <div className='AppToolbarBrand'>
                    <span className='AppToolbarLogo'>Niolesk</span>
                </div>
                <div className='AppToolbarControls'>
                    <DiagramType />
                </div>
                <div className='AppToolbarActions'>
                    {
                        !isCompact ? <div className='SplitPresetGroup' aria-label='Preview layout modes'>
                            {layoutModes.map((mode) => <button
                                key={mode}
                                type='button'
                                aria-label={`Switch to ${mode} layout`}
                                className={classNames('SplitPresetButton', { active: layoutMode === mode })}
                                onClick={() => setLayoutMode(mode)}
                            >
                                <span className={classNames('SplitPresetIcon', `SplitPresetIcon${mode[0].toUpperCase()}${mode.slice(1)}`)}>
                                    {mode === 'vertical' ? <>
                                        <span className='SplitPresetIconPane SplitPresetIconPaneNarrow' />
                                        <span className='SplitPresetIconPane SplitPresetIconPaneWide' />
                                    </> : null}
                                    {mode === 'horizontal' ? <>
                                        <span className='SplitPresetIconPane SplitPresetIconPaneTop' />
                                        <span className='SplitPresetIconPane SplitPresetIconPaneBottom' />
                                    </> : null}
                                    {mode === 'preview' ? <span className='SplitPresetIconPane SplitPresetIconPaneFull' /> : null}
                                </span>
                            </button>)}
                        </div> : null
                    }
                    <button type='button' className='AppToolbarButton' onClick={() => onExamples()}>Examples</button>
                    <button type='button' className='AppToolbarButton' onClick={() => onImportUrl()}>Import</button>
                </div>
            </header> : null
        }
        <div className='MainPanel'>
            {showChrome ? mobileTabBar : null}
            <div className={classNames('Workspace', `WorkspaceMode${layoutMode[0].toUpperCase()}${layoutMode.slice(1)}`)} ref={workspaceRef} style={{ '--editor-panel-width': `${editorWidth}%` }}>
                <section className={classNames('WorkspacePanel WorkspacePanelEditor', { compactHidden: !showEditorPane })}>
                    {
                        !isCompact ? <div className='WorkspacePanelBar'>
                            <div className='WorkspacePanelBarSpacer' />
                            <button
                                type='button'
                                className={classNames('EditorWrapButton', { active: wrapEnabled })}
                                onClick={() => setWrapEnabled((value) => !value)}
                            >
                                Wrap
                            </button>
                        </div> : null
                    }
                    <div className='WorkspacePanelBody'>
                        <Editor wrapEnabled={wrapEnabled} />
                    </div>
                </section>
                {
                    !isCompact && layoutMode === 'vertical' && showEditorPane ? <button
                        type='button'
                        aria-label='Resize panels'
                        className='WorkspaceDivider'
                        onMouseDown={() => setIsDragging(window.innerWidth > 980)}
                        onDoubleClick={() => setEditorWidth(defaultEditorWidth)}
                    /> : null
                }
                <section className={classNames('WorkspacePanel WorkspacePanelPreview', { compactHidden: !showPreviewPane, previewOnly: !isCompact && layoutMode === 'preview' })}>
                    <div className='WorkspacePanelBody'>
                        <Render />
                    </div>
                </section>
            </div>
            {
                hasAnalyticsHtml ? analyticsHtml.map((item, index) => <div key={`analytics-${index}`} className='analyticsPanel' dangerouslySetInnerHTML={{ __html: item.content }} />) : null
            }
        </div>
        {
            showChrome ? <section className={classNames('LinksDrawer', { open: linksOpen })}>
                <button type='button' className='LinksDrawerHandle' onClick={() => setLinksOpen((open) => !open)}>
                    <span className='LinksDrawerHandleText'>
                        <strong>Generated Links</strong>
                    </span>
                    <span className='LinksDrawerHandleState'>{linksOpen ? 'Close' : 'Open'}</span>
                </button>
                <div className='LinksDrawerBody'>
                    <div className='LinksDrawerControls'>
                        <RenderUrl />
                    </div>
                    <CopyZone />
                </div>
            </section> : null
        }
        <WindowExampleCards />
        <WindowExampleDetail />
        <WindowImportUrl />
    </div>
}

App.propTypes = {
    onExamples: PropTypes.func.isRequired,
    onImportUrl: PropTypes.func.isRequired,
    onKey: PropTypes.func.isRequired,
    onResize: PropTypes.func.isRequired,
};

export default App;
