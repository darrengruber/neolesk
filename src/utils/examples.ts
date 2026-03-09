import type { ExampleRecord } from '../types';
import { getExampleUrl } from '../examples/cache';
import exampleData from '../examples';

export const buildExamples = (): ExampleRecord[] =>
    exampleData.map((example, id) => ({
        id,
        ...example,
        searchField: `${example.title} ${example.description} ${(example.keywords || []).join(' ')}`.toLowerCase(),
        url: getExampleUrl(example),
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
