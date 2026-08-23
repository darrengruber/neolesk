declare module '@plantuml/core' {
    export function renderToString(
        lines: string[],
        onSuccess: (svg: string) => void,
        onError: (message: string) => void,
    ): void;
}

declare module '@plantuml/core/viz-global.js';

declare module 'svgbob-wasm/svgbob_wasm.js' {
    export function render(source: string): string;
}

declare module 'bpmn-js/lib/NavigatedViewer' {
    export interface NavigatedViewerOptions {
        container: HTMLElement;
    }

    export default class NavigatedViewer {
        constructor(options: NavigatedViewerOptions);
        importXML(xml: string): Promise<{ warnings: Array<{ message?: string }> }>;
        saveSVG(): Promise<{ svg: string }>;
        destroy(): void;
    }
}
