import type { BrowserRenderer } from '../engines/contract';
import type { RendererAdapter, RendererInput } from './rendering';

type LegacyLoader = () => Promise<BrowserRenderer>;

const lazyLegacyRenderer = ({
    id,
    label,
    languages,
    load,
}: {
    id: string;
    label: string;
    languages: string[];
    load: (language: string) => Promise<BrowserRenderer>;
}): RendererAdapter => {
    const renderers = new Map<string, Promise<BrowserRenderer>>();
    return {
        id,
        label,
        environments: ['browser'],
        languages,
        formats: ['svg'],
        async render(input) {
            let renderer = renderers.get(input.language);
            if (!renderer) {
                renderer = load(input.language);
                renderers.set(input.language, renderer);
            }
            return (await renderer).render(input);
        },
    };
};

const legacy = (
    id: string,
    label: string,
    language: string,
    load: LegacyLoader,
): RendererAdapter => lazyLegacyRenderer({ id, label, languages: [language], load });

const stringOption = (
    options: Record<string, string>,
    key: string,
    allowed: readonly string[],
): string | undefined => {
    const value = options[key];
    return value && allowed.includes(value) ? value : undefined;
};

const numberOption = (options: Record<string, string>, key: string): number | undefined => {
    const value = Number(options[key]);
    return Number.isFinite(value) ? value : undefined;
};

const booleanOption = (options: Record<string, string>, key: string): boolean | undefined => {
    if (options[key] === 'true') return true;
    if (options[key] === 'false') return false;
    return undefined;
};

const graphvizRenderer: RendererAdapter = {
    id: 'graphviz-browser',
    label: 'Graphviz browser renderer',
    environments: ['browser', 'worker'],
    languages: ['graphviz'],
    formats: ['svg'],
    async render({ source, options }) {
        const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
        const graphviz = await Graphviz.load();
        const layout = stringOption(options, 'layout', ['dot', 'circo', 'fdp', 'neato', 'osage', 'patchwork', 'sfdp', 'twopi']);
        return graphviz.layout(source, 'svg', (layout || 'dot') as Parameters<typeof graphviz.layout>[2]);
    },
};

let plantUmlReady: Promise<typeof import('@plantuml/core')> | null = null;

const loadPlantUml = async () => {
    if (!plantUmlReady) {
        plantUmlReady = import('@plantuml/core/viz-global.js')
            .then(() => import('@plantuml/core'));
    }
    return plantUmlReady;
};

const plantUmlRenderer: RendererAdapter = {
    id: 'plantuml-browser',
    label: 'PlantUML MIT browser renderer',
    environments: ['browser', 'worker'],
    languages: ['plantuml', 'c4plantuml'],
    formats: ['svg'],
    remoteWhileLoading: true,
    load: async () => { await loadPlantUml(); },
    async render({ source }) {
        const { renderToString } = await loadPlantUml();
        return new Promise<string>((resolve, reject) => {
            renderToString(source.split(/\r?\n/), resolve, (message) => reject(new Error(message)));
        });
    },
};

let d2Instance: Promise<InstanceType<typeof import('@terrastruct/d2')['D2']>> | null = null;

const d2Renderer: RendererAdapter = {
    id: 'd2-browser',
    label: 'D2 browser renderer',
    environments: ['browser', 'worker'],
    languages: ['d2'],
    formats: ['svg'],
    remoteWhileLoading: true,
    load: async () => {
        if (!d2Instance) {
            d2Instance = import('@terrastruct/d2').then(({ D2 }) => new D2());
        }
        await d2Instance;
    },
    async render({ source, options }) {
        await d2Renderer.load?.();
        const d2 = await d2Instance;
        if (!d2) throw new Error('D2 renderer did not initialize');
        const compile = await d2.compile({
            fs: { 'index.d2': source },
            inputPath: 'index.d2',
            options: {
                layout: stringOption(options, 'layout', ['dagre', 'elk']) as 'dagre' | 'elk' | undefined,
                sketch: booleanOption(options, 'sketch'),
                themeID: numberOption(options, 'theme'),
                darkThemeID: numberOption(options, 'darkTheme'),
                pad: numberOption(options, 'pad'),
                noXMLTag: true,
            },
        });
        return d2.render(compile.diagram, compile.renderOptions);
    },
};

const pikchrRenderer: RendererAdapter = {
    id: 'pikchr-browser',
    label: 'Pikchr browser renderer',
    environments: ['browser', 'worker'],
    languages: ['pikchr'],
    formats: ['svg'],
    async render({ source }) {
        const { default: pikchr } = await import('pikchr-wasm');
        await pikchr.loadWASM();
        return pikchr.render(source, 'neolesk-pikchr');
    },
};

const svgbobRenderer: RendererAdapter = {
    id: 'svgbob-browser',
    label: 'Svgbob browser renderer',
    environments: ['browser', 'worker'],
    languages: ['svgbob'],
    formats: ['svg'],
    async render({ source }) {
        const { render } = await import('svgbob-wasm/svgbob_wasm.js');
        return render(source);
    },
};

const bpmnRenderer: RendererAdapter = {
    id: 'bpmn-browser',
    label: 'bpmn-js browser renderer',
    environments: ['browser'],
    languages: ['bpmn'],
    formats: ['svg'],
    async render({ source }) {
        const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
        const container = document.createElement('div');
        container.hidden = true;
        document.body.appendChild(container);
        const viewer = new NavigatedViewer({ container });
        try {
            await viewer.importXML(source);
            return (await viewer.saveSVG()).svg;
        } finally {
            viewer.destroy();
            container.remove();
        }
    },
};

const vegaRenderer = lazyLegacyRenderer({
    id: 'vega-browser',
    label: 'Vega browser renderer',
    languages: ['vega', 'vegalite'],
    load: (language) => import('../engines/vega').then((module) => (
        language === 'vegalite' ? module.loadVegalite() : module.loadVega()
    )),
});

export const browserRendererAdapters: RendererAdapter[] = [
    bpmnRenderer,
    legacy('bytefield-browser', 'Bytefield browser renderer', 'bytefield', () => import('../engines/bytefield').then((module) => module.load())),
    d2Renderer,
    legacy('dbml-browser', 'DBML browser renderer', 'dbml', () => import('../engines/dbml').then((module) => module.load())),
    graphvizRenderer,
    legacy('mermaid-browser', 'Mermaid browser renderer', 'mermaid', () => import('../engines/mermaid').then((module) => module.load())),
    legacy('nomnoml-browser', 'Nomnoml browser renderer', 'nomnoml', () => import('../engines/nomnoml').then((module) => module.load())),
    pikchrRenderer,
    plantUmlRenderer,
    svgbobRenderer,
    vegaRenderer,
    legacy('wavedrom-browser', 'WaveDrom browser renderer', 'wavedrom', () => import('../engines/wavedrom').then((module) => module.load())),
];

export const workerRendererAdapters = browserRendererAdapters.filter((renderer) => (
    renderer.environments.includes('worker')
));

export const renderWithAdapter = (adapter: RendererAdapter, input: RendererInput) => adapter.render(input);
