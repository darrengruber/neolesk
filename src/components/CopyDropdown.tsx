import { useCallback, useEffect, useRef, useState } from 'react';
import type { CopyScope, DiagramState } from '../types';
import { getCopyText } from '../utils/share';
import { copyText } from '../utils/clipboard';

const copyScopes: { scope: CopyScope; label: string }[] = [
    { scope: 'image', label: 'Render URL' },
    { scope: 'edit', label: 'Edit URL' },
    { scope: 'markdown', label: 'Markdown snippet' },
    { scope: 'markdownsource', label: 'Markdown with source' },
];

interface CopyDropdownProps {
    previewState: DiagramState;
    editorValue: string;
    renderUrl: string;
    defaultRenderUrl: string;
    onRenderUrlChange: (url: string) => void;
}

function CopyDropdown({ previewState, editorValue, renderUrl, defaultRenderUrl, onRenderUrlChange }: CopyDropdownProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [copiedScope, setCopiedScope] = useState<CopyScope | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const handleCopy = useCallback(async (scope: CopyScope) => {
        const text = getCopyText(scope, previewState, editorValue);
        await copyText(text);
        setCopiedScope(scope);
        window.setTimeout(() => setCopiedScope(null), 1200);
    }, [previewState, editorValue]);

    useEffect(() => {
        if (!open) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    return (
        <div className="CopyDropdown" ref={panelRef}>
            <button
                type="button"
                className={`RenderToolbarButton CopyDropdownToggle${open ? ' active' : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-label="Share & copy links"
                title="Share & copy links"
            >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.5 3a2.5 2.5 0 1 1-1.72 4.32l-3.46 2a2.5 2.5 0 0 1 0 1.36l3.46 2a2.5 2.5 0 1 1-.56 1.3l-3.46-2a2.5 2.5 0 1 1 0-3.96l3.46-2A2.5 2.5 0 0 1 13.5 3Z" />
                </svg>
            </button>
            {open ? (
                <div className="CopyDropdownPanel">
                    <div className="CopyDropdownSection">
                        <label className="CopyDropdownLabel">Kroki engine</label>
                        <input
                            className="CopyDropdownInput code"
                            value={renderUrl}
                            onChange={(event) => onRenderUrlChange(event.target.value)}
                            placeholder={defaultRenderUrl}
                        />
                    </div>
                    <div className="CopyDropdownDivider" />
                    {copyScopes.map(({ scope, label }) => (
                        <div key={scope} className="CopyDropdownRow">
                            <span className="CopyDropdownRowLabel">{label}</span>
                            <button
                                type="button"
                                className={`CopyDropdownCopyButton${copiedScope === scope ? ' copied' : ''}`}
                                onClick={() => handleCopy(scope)}
                            >
                                {copiedScope === scope ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export default CopyDropdown;
