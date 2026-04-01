import { createRenderer, assertSupportedFormat } from './contract';

export async function load() {
    const { run } = await import('@softwaretechnik/dbml-renderer');

    return createRenderer({
        id: 'dbml',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('dbml', format, ['svg']);
            if (source === '') return '';
            return run(source, 'svg');
        },
    });
}
