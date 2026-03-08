import type { ExampleDefinition } from '../types';
import exampleCache from '../generated/exampleCache';

const defaultRenderUrl = 'https://kroki.io/';
const outputFormat = 'svg';

const getExampleRadical = (exampleItem: ExampleDefinition): string =>
    [exampleItem.diagramType, outputFormat, exampleItem.example].join('/');

export const getRemoteExampleUrl = (exampleItem: ExampleDefinition): string =>
    `${defaultRenderUrl}${getExampleRadical(exampleItem)}`;

export const getExampleUrl = (exampleItem: ExampleDefinition): string => {
    const radical = getExampleRadical(exampleItem);
    const cachedFilename = exampleCache[radical];

    if (cachedFilename) {
        return `./cache/${cachedFilename}`;
    }

    return getRemoteExampleUrl(exampleItem);
};
