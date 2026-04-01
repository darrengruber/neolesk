import { createRenderer, assertSupportedFormat } from './contract';

export async function load() {
    const { default: bytefield } = await import('bytefield-svg');

    return createRenderer({
        id: 'bytefield',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('bytefield', format, ['svg']);
            if (source === '') return '';
            return bytefield(source);
        },
    });
}
