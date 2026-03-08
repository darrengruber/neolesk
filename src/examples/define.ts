import { encode } from '../kroki/coder';
import type { ExampleDefinition } from '../types';

export interface ExampleSourceDefinition extends Omit<ExampleDefinition, 'example'> {
    source: string;
}

export const defineExamples = (definitions: ExampleSourceDefinition[]): ExampleDefinition[] =>
    definitions.map(({ source, ...definition }) => ({
        ...definition,
        example: encode(source),
    }));

export const lines = (parts: string[], trailingNewline = false): string =>
    parts.join('\n') + (trailingNewline ? '\n' : '');
