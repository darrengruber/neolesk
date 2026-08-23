import { describe, expect, it, vi } from 'vitest';
import { renderPlantUmlToString } from './browserAdapters';

describe('renderPlantUmlToString', () => {
    it('turns an asynchronous TeaVM page error into a rejected render', async () => {
        const render = vi.fn(() => {
            queueMicrotask(() => {
                const error = new TypeError("Cannot read properties of undefined (reading '$jsException')");
                error.stack = 'TypeError: TeaVM failure at plantuml.js:1:42';
                globalThis.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
            });
        });

        await expect(renderPlantUmlToString(render, '@startuml\n@enduml', 1_000))
            .rejects.toThrow("Cannot read properties of undefined");
    });

    it('rejects a renderer that never calls either callback', async () => {
        await expect(renderPlantUmlToString(vi.fn(), '@startuml\n@enduml', 5))
            .rejects.toThrow('timed out');
    });
});
