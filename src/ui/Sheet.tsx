import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Distance, in CSS pixels, that a downward drag on the grabber must travel to dismiss. */
const DISMISS_DISTANCE = 96;

/**
 * Safari does not focus a button when it is clicked or tapped, so
 * document.activeElement cannot name the control that opened a sheet.
 * Remember the last control a pointer pressed instead.
 */
let lastPressedControl: HTMLElement | null = null;
if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [role="button"], a[href]') : null;
        if (target) lastPressedControl = target;
    }, true);
}

const findInvoker = (): HTMLElement | null => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) return active;
    return lastPressedControl?.isConnected ? lastPressedControl : null;
};

/**
 * A modal sheet on a native <dialog>: a bottom sheet with a grabber on compact
 * screens and a centred form sheet at regular width. Escape, a tap on the
 * backdrop, Done and a downward drag all close it, and focus returns to the
 * control that opened it.
 */
export function Sheet({ open, title, onClose, children, className = '' }: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    className?: string;
}) {
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const invokerRef = useRef<HTMLElement | null>(null);
    const dragStartRef = useRef<number | null>(null);
    const titleRef = useRef<HTMLHeadingElement | null>(null);
    const titleId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            invokerRef.current = findInvoker();
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
            // Start on the title, as VoiceOver does on iOS. A tap does not
            // paint a focus ring on Done, and Tab moves on to the controls.
            titleRef.current?.focus();
        } else if (!open && dialog.open) {
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            const invoker = invokerRef.current;
            invokerRef.current = null;
            if (invoker?.isConnected) invoker.focus();
        }
    }, [open]);

    const resetDrag = () => {
        dragStartRef.current = null;
        dialogRef.current?.style.removeProperty('--sheet-drag');
        dialogRef.current?.removeAttribute('data-dragging');
    };

    return (
        <dialog
            ref={dialogRef}
            className={`Sheet ${className}`.trim()}
            aria-labelledby={titleId}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                // The dialog box is covered by its content, so a click whose
                // target is the dialog itself landed on the backdrop.
                if (event.target === event.currentTarget) onClose();
            }}
        >
            {open && (
                <div className="SheetContent">
                    <div
                        className="SheetHeader"
                        onPointerDown={(event) => {
                            if (event.pointerType === 'mouse' || (event.target as HTMLElement).closest('button')) return;
                            dragStartRef.current = event.clientY;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            dialogRef.current?.setAttribute('data-dragging', '');
                        }}
                        onPointerMove={(event) => {
                            if (dragStartRef.current === null) return;
                            const distance = Math.max(0, event.clientY - dragStartRef.current);
                            dialogRef.current?.style.setProperty('--sheet-drag', `${distance}px`);
                        }}
                        onPointerUp={(event) => {
                            if (dragStartRef.current === null) return;
                            const distance = event.clientY - dragStartRef.current;
                            resetDrag();
                            if (distance > DISMISS_DISTANCE) onClose();
                        }}
                        onPointerCancel={resetDrag}
                    >
                        <span className="SheetGrabber" aria-hidden="true" />
                        <span aria-hidden="true" />
                        <h2 id={titleId} ref={titleRef} className="SheetTitle" tabIndex={-1}>{title}</h2>
                        <button type="button" className="TextButton TextButtonBold" onClick={onClose}>Done</button>
                    </div>
                    <div className="SheetBody">{children}</div>
                </div>
            )}
        </dialog>
    );
}
