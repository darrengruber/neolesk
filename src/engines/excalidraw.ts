import { createRenderer, assertSupportedFormat } from './contract';

export async function load() {
    const { exportToSvg } = await import('@excalidraw/excalidraw');

    return createRenderer({
        id: 'excalidraw',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg' } = {}) => {
            assertSupportedFormat('excalidraw', format, ['svg']);
            if (source === '') return '';

            const scene = JSON.parse(source);
            const elements = scene.elements || [];
            const appState = scene.appState || {};
            const files = scene.files || {};

            const svg = await exportToSvg({
                elements,
                appState: {
                    ...appState,
                    exportWithDarkMode: false,
                },
                files,
            });

            return svg.outerHTML;
        },
    });
}
