import { RendererRegistry } from './registry';

const registry = new RendererRegistry();

registry.register('bytefield', () => import('./bytefield').then(m => m.load()));
registry.register('dbml', () => import('./dbml').then(m => m.load()));
registry.register('mermaid', () => import('./mermaid').then(m => m.load()));
registry.register('nomnoml', () => import('./nomnoml').then(m => m.load()));
registry.register('vega', () => import('./vega').then(m => m.loadVega()));
registry.register('vegalite', () => import('./vega').then(m => m.loadVegalite()));
registry.register('wavedrom', () => import('./wavedrom').then(m => m.load()));

export function canRenderLocally(diagramType: string): boolean {
    return registry.has(diagramType);
}

export async function renderLocally(diagramType: string, source: string): Promise<string> {
    const renderer = await registry.get(diagramType);
    if (!renderer) {
        throw new Error(`No local renderer for: ${diagramType}`);
    }
    return renderer.render({ source, format: 'svg' });
}
