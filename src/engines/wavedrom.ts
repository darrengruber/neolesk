import { createRenderer, assertSupportedFormat } from './contract';
import JSON5 from 'json5';

export async function load() {
    const [onml, wavedrom] = await Promise.all([
        import('onml'),
        import('wavedrom'),
    ]);

    return createRenderer({
        id: 'wavedrom',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('wavedrom', format, ['svg']);
            if (source === '') return '';
            const json = JSON5.parse(source);
            return onml.s(wavedrom.renderAny(0, json, wavedrom.waveSkin));
        },
    });
}
