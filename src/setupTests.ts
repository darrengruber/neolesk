import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

globalThis.jest = vi as any;

// CodeMirror measures native ranges. jsdom intentionally omits the geometry
// methods, so provide empty geometry rather than letting an async measure pass
// fail after an otherwise successful editor test.
Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList);
Range.prototype.getBoundingClientRect ??= (() => new DOMRect());

if (!window.localStorage) {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => Array.from(values.keys())[index] ?? null,
        removeItem: (key) => { values.delete(key); },
        setItem: (key, value) => { values.set(key, value); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver);

afterEach(() => {
    cleanup();
});
