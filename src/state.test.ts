import {
    buildDiagramState,
    changeDiagramType,
    createDiagramHash,
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

    it('accepts all client-side export formats', () => {
        expect(getValidFiletype('mermaid', 'pdf')).toBe('pdf');
        expect(getValidFiletype('mermaid', 'jpeg')).toBe('jpeg');
    });

    it('falls back to svg for unknown formats', () => {
        expect(getValidFiletype('plantuml', 'gif')).toBe('svg');
    });
});

describe('parseDiagramUrl', () => {
    it('parses legacy full Kroki URLs', () => {
        const encoded = encode('@startuml\nAlice -> Bob\n@enduml');
        const parsed = parseDiagramUrl(`#https://kroki.io/plantuml/png/${encoded}`);

        expect(parsed).toEqual({
            diagramType: 'plantuml',
            filetype: 'png',
            diagramText: '@startuml\nAlice -> Bob\n@enduml',
        });
    });

    it('parses new compact hash format', () => {
        const encoded = encode('@startuml\nAlice -> Bob\n@enduml');
        const parsed = parseDiagramUrl(`#plantuml/svg/${encoded}`);

        expect(parsed).toEqual({
            diagramType: 'plantuml',
            filetype: 'svg',
            diagramText: '@startuml\nAlice -> Bob\n@enduml',
        });
    });

    it('returns null for incomplete urls', () => {
        expect(parseDiagramUrl('#https://kroki.io/plantuml')).toBeNull();
    });

    it('returns null for incomplete new-format hashes', () => {
        expect(parseDiagramUrl('#plantuml/svg')).toBeNull();
    });
});

describe('createDiagramHash', () => {
    it('creates a compact hash without server URL', () => {
        const encoded = encode('test');
        expect(createDiagramHash('plantuml', 'svg', encoded)).toBe(`plantuml/svg/${encoded}`);
    });
});

describe('createInitialDiagramState', () => {
    it('uses the default diagram when there is no hash', () => {
        const state = createInitialDiagramState('https://neolesk.test/', '');

        expect(state.diagramType).toBe(defaultDiagramType);
        expect(state.renderUrl).toBe(defaultRenderUrl);
        expect(state.svgUrl).toContain('/plantuml/svg/');
    });
});

describe('changeDiagramType', () => {
    it('replaces default diagrams with the next diagram type example', () => {
        const initialState = createInitialDiagramState('https://neolesk.test/', '');
        const nextState = changeDiagramType(initialState, 'mermaid');

        expect(nextState.diagramType).toBe('mermaid');
        expect(nextState.diagramText).not.toBe(initialState.diagramText);
        expect(nextState.filetype).toBe('svg');
    });

    it('preserves custom diagrams when switching type', () => {
        const initialState = buildDiagramState({
            baseUrl: 'https://neolesk.test/',
            diagramType: 'plantuml',
            diagramText: '@startuml\nAlice -> Bob: custom\n@enduml',
            filetype: 'svg',
            renderUrl: defaultRenderUrl,
        });

        const nextState = changeDiagramType(initialState, 'mermaid');

        expect(nextState.diagramText).toBe(initialState.diagramText);
    });
});
