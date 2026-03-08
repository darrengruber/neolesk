import type { ExampleDefinition } from '../types';
import exampleCache from '../generated/exampleCache';

const defaultRenderUrl = 'https://kroki.io/';

export const getExampleUrl = (exampleItem: ExampleDefinition): string => {
    const ext = 'svg';
    const radical = [exampleItem.diagramType, ext, exampleItem.example].join('/');
    const cachedFilename = exampleCache[radical];

    if (cachedFilename) {
        return `./cache/${cachedFilename}`;
    }

    return `${defaultRenderUrl}${radical}`;
};
