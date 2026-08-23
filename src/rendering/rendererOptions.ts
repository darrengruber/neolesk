import type { RendererOptionDefinition } from './rendering';

export const GRAPHVIZ_LAYOUTS = [
    'dot',
    'circo',
    'fdp',
    'neato',
    'osage',
    'patchwork',
    'sfdp',
    'twopi',
] as const;

export const D2_LAYOUTS = ['dagre'] as const;

export const GRAPHVIZ_OPTION_DEFINITIONS: Record<string, RendererOptionDefinition> = {
    layout: { type: 'enum', values: GRAPHVIZ_LAYOUTS },
};

export const D2_OPTION_DEFINITIONS: Record<string, RendererOptionDefinition> = {
    layout: { type: 'enum', values: D2_LAYOUTS },
    sketch: { type: 'boolean' },
    theme: { type: 'number', minimum: 0 },
    darkTheme: { type: 'number', minimum: 0 },
    pad: { type: 'number', minimum: 0, maximum: 512 },
};
