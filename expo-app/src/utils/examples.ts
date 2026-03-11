import type { ExampleRecord } from '../types';
import exampleData from '../examples';
import { encode } from '../kroki/coder';
import { defaultRenderUrl } from '../state';

const createKrokiUrl = (diagramType: string, encodedText: string): string =>
    `${defaultRenderUrl}${diagramType}/svg/${encodedText}`;

export const buildExamples = (): ExampleRecord[] =>
    exampleData.map((example, id) => ({
        id,
        ...example,
        searchField: `${example.title} ${example.description} ${(example.keywords || []).join(' ')}`.toLowerCase(),
        url: createKrokiUrl(example.diagramType, example.example),
    }));

export const filterExamples = (examples: ExampleRecord[], search: string): ExampleRecord[] => {
    const parts = search
        .split(' ')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);

    if (parts.length === 0) {
        return examples;
    }

    return examples.filter((example) => parts.every((part) => example.searchField.includes(part)));
};
