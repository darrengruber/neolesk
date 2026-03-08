import type { ExampleDefinition } from '../types';

const defaultRenderUrl = 'https://kroki.io/';

export const getExampleUrl = (exampleItem: ExampleDefinition): string => {
    const ext = 'svg';
    const radical = [exampleItem.diagramType, ext, exampleItem.example].join('/');
    return `${defaultRenderUrl}${radical}`;
};
