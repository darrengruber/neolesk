import { useEffect, useState } from 'react';

export const useWindowWidth = (): number => {
    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

    useEffect(() => {
        let rafId = 0;
        const handleResize = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                setWindowWidth(window.innerWidth);
                rafId = 0;
            });
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    return windowWidth;
};
