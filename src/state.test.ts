import {
    buildDiagramState,
    changeDiagramType,
    createInitialDiagramState,
    defaultDiagramType,
    defaultRenderUrl,
    getValidFiletype,
    normalizeRenderUrl,
    parseDiagramUrl,
} from './state';
import { encode } from './kroki/coder';

describe('normalizeRenderUrl', () => {
    it('maps legacy kroki hosts to the configured default', () => {
        expect(normalizeRenderUrl('https://kroki.io/')).toBe(defaultRenderUrl);
        expect(normalizeRenderUrl('https://kroki.io')).toBe(defaultRenderUrl);
        expect(normalizeRenderUrl('')).toBe(defaultRenderUrl);
    });

    it('normalizes trailing slashes', () => {
        expect(normalizeRenderUrl('https://example.test')).toBe('https://example.test/');
        expect(normalizeRenderUrl('https://example.test/')).toBe('https://example.test/');
    });
});

describe('getValidFiletype', () => {
    it('preserves supported output formats', () => {
        expect(getValidFiletype('plantuml', 'png')).toBe('png');
    });

    it('falls back to the first supported output format', () => {
        expect(getValidFiletype('mermaid', 'pdf')).toBe('svg');
    });
});

describe('parseDiagramUrl', () => {
    it('parses diagram urls and migrates the legacy host', () => {
        const encoded = encode('@startuml\nAlice -> Bob\n@enduml');
        const parsed = parseDiagramUrl(`#https://kroki.io/plantuml/png/${encoded}`);

        expect(parsed).toEqual({
            diagramType: 'plantuml',
            filetype: 'png',
            renderUrl: defaultRenderUrl,
            diagramText: '@startuml\nAlice -> Bob\n@enduml',
        });
    });

    it('returns null for incomplete urls', () => {
        expect(parseDiagramUrl('#https://kroki.io/plantuml')).toBeNull();
    });
});

describe('createInitialDiagramState', () => {
    it('uses the default diagram when there is no hash', () => {
        const state = createInitialDiagramState('https://niolesk.test/', '');

        expect(state.diagramType).toBe(defaultDiagramType);
        expect(state.renderUrl).toBe(defaultRenderUrl);
        expect(state.diagramUrl).toContain('/plantuml/svg/');
    });
});

describe('changeDiagramType', () => {
    it('replaces default diagrams with the next diagram type example', () => {
        const initialState = createInitialDiagramState('https://niolesk.test/', '');
        const nextState = changeDiagramType(initialState, 'mermaid');

        expect(nextState.diagramType).toBe('mermaid');
        expect(nextState.diagramText).not.toBe(initialState.diagramText);
        expect(nextState.filetype).toBe('svg');
    });

    it('preserves custom diagrams when switching type', () => {
        const initialState = buildDiagramState({
            baseUrl: 'https://niolesk.test/',
            diagramType: 'plantuml',
            diagramText: '@startuml\nAlice -> Bob: custom\n@enduml',
            filetype: 'svg',
            renderUrl: defaultRenderUrl,
        });

        const nextState = changeDiagramType(initialState, 'mermaid');

        expect(nextState.diagramText).toBe(initialState.diagramText);
    });
});
