import type { ExampleDefinition } from '../types';
import examples from '../examples';
import { encode } from '../kroki/coder';
import { defaultRenderUrl } from '../state';
import { getExampleCacheFilename, getExampleCacheFilenameForRadical, getExampleRadical } from './cacheKey';
const cachedExampleRadicals = new Set(examples.map((example) => getExampleRadical(example)));

export const getExampleUrl = (exampleItem: ExampleDefinition): string => {
    const cachedFilename = getExampleCacheFilename(exampleItem);
    return `./cache/${cachedFilename}`;
};

export const getCachedSvgUrl = (
    diagramType: string,
    diagramText: string,
    renderUrl: string,
): string | null => {
    if (renderUrl !== defaultRenderUrl) {
        return null;
    }

    const encodedDiagram = encode(diagramText);
    const radical = [diagramType, 'svg', encodedDiagram].join('/');

    if (!cachedExampleRadicals.has(radical)) {
        return null;
    }

    return `./cache/${getExampleCacheFilenameForRadical(radical)}`;
};
