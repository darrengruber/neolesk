import { describe, expect, it } from 'vitest';
import { browserRendererCatalog } from './catalog';
import { workerRendererCatalog } from './workerCatalog';
import { createKrokiRemoteRenderer } from './remote';

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

    it('shares Graphviz and D2 option contracts across every runtime', () => {
        const remote = createKrokiRemoteRenderer({ id: 'kroki', label: 'Kroki', url: 'https://kroki.example/' });

        for (const language of ['graphviz', 'd2']) {
            const remoteDefinitions = remote.capabilities[language].optionDefinitions;
            expect(browserRendererCatalog.find(language, 'browser', 'svg')?.optionDefinitions)
                .toBe(remoteDefinitions);
            expect(workerRendererCatalog.find(language, 'worker', 'svg')?.optionDefinitions)
                .toBe(remoteDefinitions);
        }
    });
});
