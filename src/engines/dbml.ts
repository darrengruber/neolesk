import { createRenderer, assertSupportedFormat } from './contract';

export async function load() {
    const { run } = await import('@softwaretechnik/dbml-renderer');
    const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
    const graphviz = await Graphviz.load();

    return createRenderer({
        id: 'dbml',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('dbml', format, ['svg']);
            if (source === '') return '';
            // dbml-renderer's SVG path loads the Node-only synchronous Viz.js
            // bundle. Its DOT path is browser-safe, so use our existing WASM
            // Graphviz renderer for the final conversion.
            return graphviz.layout(run(source, 'dot'), 'svg', 'dot');
        },
    });
}
