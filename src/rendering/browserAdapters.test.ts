import { describe, expect, it, vi } from 'vitest';
import { assertPlantUmlSupported, renderPlantUmlToString, wrapPlantUmlSource } from './browserAdapters';

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

describe('wrapPlantUmlSource', () => {
    it('wraps a diagram body the way a PlantUML render server does', () => {
        expect(wrapPlantUmlSource('skinparam monochrome true\na -> b'))
            .toBe('@startuml\nskinparam monochrome true\na -> b\n@enduml');
    });

    it('leaves source that already declares its diagram type unchanged', () => {
        for (const source of [
            '@startuml\na -> b\n@enduml',
            '\n  @startmindmap\n* a\n@endmindmap',
            "' comment\n@startsalt\n{}\n@endsalt",
        ]) {
            expect(wrapPlantUmlSource(source)).toBe(source);
        }
    });
});

describe('assertPlantUmlSupported', () => {
    // Markup as the @plantuml/core MIT build returns it for `@startsalt`.
    const unsupported = '<svg><g><text font-weight="bold">Diagram not supported by this release of PlantUML</text>'
        + '<text font-family="sans-serif">Sorry, but the following directive </text>'
        + '<text font-family="monospace">@startsalt</text>'
        + '<text font-family="sans-serif"> is not recognized.</text></g></svg>';

    it('turns the MIT build explanation into a rejection that names the directive', () => {
        expect(() => assertPlantUmlSupported(unsupported))
            .toThrow('The PlantUML browser build does not support @startsalt. A render server can draw it.');
    });

    it('passes a drawn diagram through unchanged', () => {
        const svg = '<svg><text>a</text><text>b</text></svg>';
        expect(assertPlantUmlSupported(svg)).toBe(svg);
    });
});
