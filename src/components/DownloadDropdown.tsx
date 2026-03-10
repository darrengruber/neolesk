import { useEffect, useRef, useState } from 'react';

interface DownloadDropdownProps {
    filetypes: string[];
    disabled: boolean;
    downloading: boolean;
    onDownload: (filetype: string) => void;
}

function DownloadDropdown({ filetypes, disabled, downloading, onDownload }: DownloadDropdownProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);

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

    const handleItemClick = (filetype: string) => {
        setOpen(false);
        onDownload(filetype);
    };

    return (
        <div className="DownloadDropdown" ref={panelRef}>
            <button
                type="button"
                className={`RenderToolbarButton DownloadDropdownToggle${open ? ' active' : ''}`}
                onClick={() => setOpen((v) => !v)}
                disabled={disabled}
                aria-label="Download diagram"
                title="Download diagram"
            >
                {downloading ? (
                    <span className="DownloadDropdownSpinner" />
                ) : (
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 2.5a.75.75 0 0 1 .75.75v8.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 1.06-1.06l2.72 2.72V3.25A.75.75 0 0 1 10 2.5ZM3.5 14.25a.75.75 0 0 1 .75.75v.5h11.5v-.5a.75.75 0 0 1 1.5 0v.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5v-.5a.75.75 0 0 1 .75-.75Z" />
                    </svg>
                )}
            </button>
            {open ? (
                <div className="DownloadDropdownPanel">
                    {filetypes.map((ft) => (
                        <button
                            key={ft}
                            type="button"
                            className="DownloadDropdownItem"
                            onClick={() => handleItemClick(ft)}
                        >
                            {ft.toUpperCase()}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export default DownloadDropdown;
