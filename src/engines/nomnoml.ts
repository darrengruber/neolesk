import { createRenderer, assertSupportedFormat } from './contract';

export async function load() {
    const { default: nomnoml } = await import('nomnoml');

    return createRenderer({
        id: 'nomnoml',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('nomnoml', format, ['svg']);
            if (source === '') return '';
            return nomnoml.renderSvg(source);
        },
    });
}
