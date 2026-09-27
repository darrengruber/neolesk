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

/**
 * PlantUML servers, Kroki included, wrap a diagram body without an `@start...` line in
 * `@startuml`/`@enduml`. The MIT build does not. This mirrors the browser adapter helper.
 */
const wrapPlantUmlSource = (source: string): string => (
    /^\s*@start/m.test(source) ? source : `@startuml\n${source}\n@enduml`
);

const PLANTUML_UNSUPPORTED = 'Diagram not supported by this release of PlantUML';

/** PlantUML reports source errors as an error diagram, not through its failure callback. */
const plantUmlErrorFromSvg = (svg: string, lineOffset = 0): Error | null => {
    // The MIT build omits some diagram types, such as Salt, and draws an explanation instead.
    if (svg.includes(PLANTUML_UNSUPPORTED)) {
        const directive = svg.match(/following directive\s*(?:<[^>]*>\s*)*([^<]*?)\s*(?:<[^>]*>\s*)*is not recognized/i)?.[1]
            ?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
        return new Error(directive
            ? `The PlantUML MIT build does not support ${directive}. A render server can draw it.`
            : 'The PlantUML MIT build does not support this diagram. A render server can draw it.');
    }
    const origin = svg.match(/>\[From [^<]*?\(line (\d+)\)\s*\]<\/text>/);
    if (!origin) return null;
    const messages = Array.from(svg.matchAll(/<text\b[^>]*\bfill="#FF0000"[^>]*>([^<]*)<\/text>/g))
        .map((match) => match[1].trim())
        .filter(Boolean);
    if (messages.length === 0) return null;
    return new Error(`${messages.join(' ')} (line ${Math.max(1, Number(origin[1]) - lineOffset)})`);
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
        // A render that never calls back leaves the single TeaVM thread busy, so later
        // renders would each wait for the full timeout. Fail fast and let Kroki take over.
        if (plantUmlStalled) throw new Error('PlantUML runtime stalled after an earlier render timed out');
        const { installWorkerPlantUmlPlatform, loadWorkerViz } = await import('./workerRuntimes');
        await loadWorkerViz();
        installWorkerPlantUmlPlatform();
        const { renderToString } = await import('@plantuml/core');
        const wrapped = wrapPlantUmlSource(source);
        const svg = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                plantUmlStalled = true;
                reject(new Error('PlantUML render timed out'));
            }, 30_000);
            (renderToString as PlantUmlRender)(
                wrapped.split(/\r?\n/),
                (output) => { clearTimeout(timeout); resolve(output); },
                (message) => { clearTimeout(timeout); reject(new Error(message)); },
            );
        });
        const sourceError = plantUmlErrorFromSvg(svg, wrapped === source ? 0 : 1);
        if (sourceError) throw sourceError;
        return svg;
    },
};
let plantUmlStalled = false;

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
    async render({ source }) {
        const output = await (await import('./workerRuntimes')).renderWorkerPikchr(source);
        // Pikchr returns an HTML error block instead of SVG when the source is invalid.
        if (!/^\s*<svg\b/i.test(output)) {
            const text = output.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const markers = Array.from(text.matchAll(/\/\*\s*(\d+)\s*\*\//g));
            const line = markers[markers.length - 1]?.[1];
            const message = text.match(/ERROR:\s*(.+)/)?.[1]?.trim() || 'Pikchr could not render the source';
            throw new Error(line ? `${message} (line ${line})` : message);
        }
        return output;
    },
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
