import { useEffect, useState } from 'react';

/** A drop larger than this between the layout and visual viewport means a software keyboard is up. */
const KEYBOARD_THRESHOLD = 120;

/**
 * Track the visual viewport so the shell can follow the iOS keyboard. Safari
 * ignores `interactive-widget`, so without this the editor's lower half and
 * the tab bar sit underneath the keyboard.
 */
export const useVisualViewport = (): { keyboardOpen: boolean } => {
    const [keyboardOpen, setKeyboardOpen] = useState(false);

    useEffect(() => {
        const viewport = window.visualViewport;
        if (!viewport) return undefined;
        const root = document.documentElement;
        const update = () => {
            root.style.setProperty('--viewport-height', `${viewport.height}px`);
            root.style.setProperty('--viewport-offset', `${viewport.offsetTop}px`);
            // A pinch-zoomed page also shrinks the visual viewport; only an unzoomed drop is a keyboard.
            setKeyboardOpen(viewport.scale <= 1.01 && window.innerHeight - viewport.height > KEYBOARD_THRESHOLD);
        };
        update();
        viewport.addEventListener('resize', update);
        viewport.addEventListener('scroll', update);
        return () => {
            viewport.removeEventListener('resize', update);
            viewport.removeEventListener('scroll', update);
            root.style.removeProperty('--viewport-height');
            root.style.removeProperty('--viewport-offset');
        };
    }, []);

    return { keyboardOpen };
};
