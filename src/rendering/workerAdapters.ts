import type { RendererAdapter } from './rendering';
import { D2_OPTION_DEFINITIONS, GRAPHVIZ_LAYOUTS, GRAPHVIZ_OPTION_DEFINITIONS } from './rendererOptions';

const stringOption = (options: Record<string, string>, key: string, values: readonly string[]) => {
    const value = options[key];
    return value && values.includes(value) ? value : undefined;
};

let vizInstance: Promise<{
    renderString(source: string, options: { format: string; engine: string }): string;
}> | null = null;
const getVizInstance = async () => {
    if (!vizInstance) {
        vizInstance = import('./workerRuntimes')
            .then(({ loadWorkerViz }) => loadWorkerViz())
            .then((runtime) => runtime.instance());
    }
    return vizInstance;
};

const graphvizRenderer: RendererAdapter = {
    id: 'graphviz-worker',
    label: 'Graphviz Worker renderer',
    environments: ['worker'],
    languages: ['graphviz'],
    formats: ['svg'],
    optionDefinitions: GRAPHVIZ_OPTION_DEFINITIONS,
    async render({ source, options }) {
        const viz = await getVizInstance();
        return viz.renderString(source, {
            format: 'svg',
            engine: stringOption(options, 'layout', GRAPHVIZ_LAYOUTS) || 'dot',
        });
    },
};

type PlantUmlRender = (
    source: string[],
    success: (svg: string) => void,
    failure: (message: string) => void,
) => void;

const plantUmlRenderer: RendererAdapter = {
    id: 'plantuml-worker',
    label: 'PlantUML MIT Worker renderer',
    environments: ['worker'],
    languages: ['plantuml', 'c4plantuml'],
    formats: ['svg'],
    remoteOnError: true,
    async render({ source }) {
        const { installWorkerPlantUmlPlatform, loadWorkerViz } = await import('./workerRuntimes');
        await loadWorkerViz();
        installWorkerPlantUmlPlatform();
        const { renderToString } = await import('@plantuml/core');
        return new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('PlantUML render timed out')), 30_000);
            (renderToString as PlantUmlRender)(
                source.split(/\r?\n/),
                (svg) => { clearTimeout(timeout); resolve(svg); },
                (message) => { clearTimeout(timeout); reject(new Error(message)); },
            );
        });
    },
};

const d2Renderer: RendererAdapter = {
    id: 'd2-worker',
    label: 'D2 Worker renderer',
    environments: ['worker'],
    languages: ['d2'],
    formats: ['svg'],
    optionDefinitions: D2_OPTION_DEFINITIONS,
    async render({ source, options }) {
        const { loadWorkerD2 } = await import('./workerRuntimes');
        const runtime = await loadWorkerD2();
        const compileResponse = JSON.parse(await runtime.compile(JSON.stringify({
            fs: { 'index.d2': source },
            inputPath: 'index.d2',
            options: {
                layout: options.layout,
                sketch: options.sketch === undefined ? undefined : options.sketch === 'true',
                themeID: options.theme === undefined ? undefined : Number(options.theme),
                darkThemeID: options.darkTheme === undefined ? undefined : Number(options.darkTheme),
                pad: options.pad === undefined ? undefined : Number(options.pad),
                noXMLTag: true,
            },
        })));
        if (compileResponse.error) throw new Error(compileResponse.error.message);
        const renderResponse = JSON.parse(await runtime.render(JSON.stringify({
            diagram: compileResponse.data.diagram,
            options: compileResponse.data.renderOptions,
        })));
        if (renderResponse.error) throw new Error(renderResponse.error.message);
        return new TextDecoder().decode(Uint8Array.from(
            atob(renderResponse.data),
            (character) => character.charCodeAt(0),
        ));
    },
};

const pikchrRenderer: RendererAdapter = {
    id: 'pikchr-worker',
    label: 'Pikchr Worker renderer',
    environments: ['worker'],
    languages: ['pikchr'],
    formats: ['svg'],
    render: async ({ source }) => (await import('./workerRuntimes')).renderWorkerPikchr(source),
};

const svgbobRenderer: RendererAdapter = {
    id: 'svgbob-worker',
    label: 'Svgbob Worker renderer',
    environments: ['worker'],
    languages: ['svgbob'],
    formats: ['svg'],
    render: async ({ source }) => (await import('./workerRuntimes')).renderWorkerSvgbob(source),
};

export const workerRendererAdapters: RendererAdapter[] = [
    graphvizRenderer,
    plantUmlRenderer,
    d2Renderer,
    pikchrRenderer,
    svgbobRenderer,
];
