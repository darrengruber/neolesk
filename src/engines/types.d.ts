declare module 'bytefield-svg' {
    export default function bytefield(source: string): string;
}

declare module 'onml' {
    export function s(jsonml: unknown): string;
}

declare module 'wavedrom' {
    export function renderAny(id: number, json: unknown, skins: unknown): unknown;
    export const waveSkin: unknown;
}

declare module 'vega-lite' {
    export function compile(spec: unknown, options?: { logger?: unknown }): { spec: unknown };
}
