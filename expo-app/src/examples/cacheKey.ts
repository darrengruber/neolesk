import type { ExampleDefinition } from '../types';

const outputFormat = 'svg';
const fnvOffsetBasis = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const uint64Mask = 0xffffffffffffffffn;

const toHash = (value: string): string => {
    let hash = fnvOffsetBasis;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = (hash * fnvPrime) & uint64Mask;
    }

    return hash.toString(16).padStart(16, '0');
};

export const getExampleRadical = (exampleItem: ExampleDefinition): string =>
    [exampleItem.diagramType, outputFormat, exampleItem.example].join('/');

export const getExampleCacheFilename = (exampleItem: ExampleDefinition): string =>
    `${toHash(getExampleRadical(exampleItem))}.${outputFormat}`;

export const getExampleCacheFilenameForRadical = (radical: string): string =>
    `${toHash(radical)}.${outputFormat}`;
