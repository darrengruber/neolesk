import { createRenderer, assertSupportedFormat } from './contract';

const nullLogger = {
    warn: () => {},
    info: () => {},
    debug: () => {},
};

async function renderVegaSvg(source: string, specFormat: 'default' | 'lite'): Promise<string> {
    if (source === '') return '';
    const { parse, View } = await import('vega');
    let spec = JSON.parse(source);
    if (specFormat === 'lite') {
        const { compile } = await import('vega-lite');
        spec = compile(spec, { logger: nullLogger }).spec;
    }
    const view = new View(parse(spec), { renderer: 'svg' }).finalize();
    return await view.toSVG();
}

export async function loadVega() {
    return createRenderer({
        id: 'vega',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('vega', format, ['svg']);
            return renderVegaSvg(source, 'default');
        },
    });
}

export async function loadVegalite() {
    return createRenderer({
        id: 'vegalite',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('vegalite', format, ['svg']);
            return renderVegaSvg(source, 'lite');
        },
    });
}
