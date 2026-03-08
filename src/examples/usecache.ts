import type { ExampleDefinition } from '../types';
import examples from '../examples';
import { encode } from '../kroki/coder';
import { getExampleCacheFilename, getExampleCacheFilenameForRadical, getExampleRadical } from './cacheKey';

const defaultRenderUrl = 'https://kroki.io/';
const cachedExampleRadicals = new Set(examples.map((example) => getExampleRadical(example)));

export const getExampleUrl = (exampleItem: ExampleDefinition): string => {
    const cachedFilename = getExampleCacheFilename(exampleItem);
    return `./cache/${cachedFilename}`;
};

export const getCachedDiagramUrl = (
    diagramType: string,
    filetype: string,
    diagramText: string,
    renderUrl: string,
): string | null => {
    if (filetype !== 'svg' || renderUrl !== defaultRenderUrl) {
        return null;
    }

    const encodedDiagram = encode(diagramText);
    const radical = [diagramType, filetype, encodedDiagram].join('/');

    if (!cachedExampleRadicals.has(radical)) {
        return null;
    }

    return `./cache/${getExampleCacheFilenameForRadical(radical)}`;
};
