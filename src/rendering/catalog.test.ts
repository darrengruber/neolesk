import { describe, expect, it } from 'vitest';
import { browserRendererCatalog, workerRendererCatalog } from './catalog';

const browserLanguages = [
    'bpmn',
    'bytefield',
    'c4plantuml',
    'd2',
    'dbml',
    'graphviz',
    'mermaid',
    'nomnoml',
    'pikchr',
    'plantuml',
    'svgbob',
    'vega',
    'vegalite',
    'wavedrom',
];

describe('renderer catalog', () => {
    it('advertises every ADR-approved browser-rendered language', () => {
        expect(browserLanguages.filter((language) => (
            browserRendererCatalog.capabilities(language, 'browser').local
        ))).toEqual(browserLanguages);
    });

    it('advertises only DOM-free renderers inside a session cell', () => {
        const locallyRendered = browserLanguages.filter((language) => (
            workerRendererCatalog.capabilities(language, 'worker').local
        ));

        expect(locallyRendered).toEqual([
            'c4plantuml',
            'd2',
            'graphviz',
            'pikchr',
            'plantuml',
            'svgbob',
        ]);
    });

    it('keeps renderer identity separate from diagram language', () => {
        expect(browserRendererCatalog.capabilities('plantuml', 'browser').rendererIds)
            .toEqual(['plantuml-browser']);
        expect(browserRendererCatalog.capabilities('c4plantuml', 'browser').rendererIds)
            .toEqual(['plantuml-browser']);
        expect(browserRendererCatalog.capabilities('vega', 'browser').rendererIds)
            .toEqual(['vega-browser']);
        expect(browserRendererCatalog.capabilities('vegalite', 'browser').rendererIds)
            .toEqual(['vega-browser']);
    });
});
