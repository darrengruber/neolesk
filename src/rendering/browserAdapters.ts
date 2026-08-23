import type { BrowserRenderer } from '../engines/contract';
import type { RendererAdapter, RendererInput } from './rendering';
import {
    D2_LAYOUTS,
    D2_OPTION_DEFINITIONS,
    GRAPHVIZ_LAYOUTS,
    GRAPHVIZ_OPTION_DEFINITIONS,
} from './rendererOptions';

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
    environments: ['browser'],
    languages: ['graphviz'],
    formats: ['svg'],
    optionDefinitions: GRAPHVIZ_OPTION_DEFINITIONS,
    async render({ source, options }) {
        const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
        const graphviz = await Graphviz.load();
        const layout = stringOption(options, 'layout', GRAPHVIZ_LAYOUTS);
        return graphviz.layout(source, 'svg', (layout || 'dot') as Parameters<typeof graphviz.layout>[2]);
    },
};

let plantUmlReady: Promise<typeof import('@plantuml/core')> | null = null;

const loadClassicScript = (url: string): Promise<void> => new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-neolesk-src="${url}"]`);
    if (existing?.dataset.loaded === 'true') {
        resolve();
        return;
    }
    const script = existing || document.createElement('script');
    script.dataset.neoleskSrc = url;
    script.src = url;
    script.async = true;
    script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('PlantUML Graphviz runtime failed to load')), { once: true });
    if (!existing) document.head.append(script);
});

const loadPlantUml = async () => {
    if (!plantUmlReady) {
        plantUmlReady = (typeof document === 'undefined'
            ? import('@plantuml/core/viz-global.js').then(() => undefined)
            : loadClassicScript(__PLANTUML_VIZ_URL__))
            .then(() => import('@plantuml/core'));
    }
    return plantUmlReady;
};

type PlantUmlRender = (
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
) => void;

export const renderPlantUmlToString = (
    render: PlantUmlRender,
    source: string,
    timeoutMs = 30_000,
): Promise<string> => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        globalThis.removeEventListener?.('error', onGlobalError);
        outcome();
    };
    const onGlobalError = (event: Event) => {
        const errorEvent = event as ErrorEvent;
        const error = errorEvent.error instanceof Error
            ? errorEvent.error
            : new Error(errorEvent.message || 'PlantUML failed asynchronously');
        const origin = `${errorEvent.filename || ''}\n${error.stack || ''}`.toLowerCase();
        if (!origin.includes('plantuml')) return;
        errorEvent.preventDefault?.();
        finish(() => reject(error));
    };
    const timeout = setTimeout(
        () => finish(() => reject(new Error(`PlantUML render timed out after ${timeoutMs}ms`))),
        timeoutMs,
    );

    globalThis.addEventListener?.('error', onGlobalError);
    try {
        render(
            source.split(/\r?\n/),
            (svg) => finish(() => resolve(svg)),
            (message) => finish(() => reject(new Error(message))),
        );
    } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
});

const plantUmlRenderer: RendererAdapter = {
    id: 'plantuml-browser',
    label: 'PlantUML MIT browser renderer',
    environments: ['browser'],
    languages: ['plantuml', 'c4plantuml'],
    formats: ['svg'],
    remoteWhileLoading: true,
    load: async () => { await loadPlantUml(); },
    async render({ source }) {
        const { renderToString } = await loadPlantUml();
        return renderPlantUmlToString(renderToString, source);
    },
};

let d2Instance: Promise<InstanceType<typeof import('@terrastruct/d2')['D2']>> | null = null;

const d2Renderer: RendererAdapter = {
    id: 'd2-browser',
    label: 'D2 browser renderer',
    environments: ['browser'],
    languages: ['d2'],
    formats: ['svg'],
    optionDefinitions: D2_OPTION_DEFINITIONS,
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
                layout: stringOption(options, 'layout', D2_LAYOUTS) as 'dagre' | undefined,
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
    environments: ['browser'],
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
    environments: ['browser'],
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

export const renderWithAdapter = (adapter: RendererAdapter, input: RendererInput) => adapter.render(input);
