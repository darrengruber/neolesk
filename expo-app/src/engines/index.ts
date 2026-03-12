import { Platform } from 'react-native';

export interface LocalEngine {
    /** Render diagram source text to an SVG string. */
    render(source: string): Promise<string>;
}

type EngineFactory = () => Promise<LocalEngine>;

const registry: Record<string, EngineFactory> = {};

export const registerEngine = (diagramType: string, factory: EngineFactory): void => {
    registry[diagramType] = factory;
};

export const hasLocalEngine = (diagramType: string): boolean =>
    diagramType in registry;

export const renderLocal = async (diagramType: string, source: string): Promise<string> => {
    const factory = registry[diagramType];
    if (!factory) {
        throw new Error(`No local engine for "${diagramType}"`);
    }
    const engine = await factory();
    return engine.render(source);
};

// Only register client-side engines on web (they need DOM APIs)
if (Platform.OS === 'web') {
    registerEngine('nomnoml', () => import('./nomnoml').then((m) => m.default));
    registerEngine('mermaid', () => import('./mermaid').then((m) => m.default));
    registerEngine('graphviz', () => import('./graphviz').then((m) => m.default));
    registerEngine('vega', () => import('./vega').then((m) => m.default));
    registerEngine('vegalite', () => import('./vegalite').then((m) => m.default));
    registerEngine('wavedrom', () => import('./wavedrom').then((m) => m.default));
}
