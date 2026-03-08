import CryptoJS from 'crypto-js';
import type { ExampleDefinition } from '../types';

const md5 = (s: string): string => CryptoJS.MD5(s).toString();
const cache: string[] = window.cache || [];
const defaultRenderUrl = 'https://kroki.io/';

export const getExampleUrl = (exampleItem: ExampleDefinition): string => {
    const ext = 'svg';
    const radical = [exampleItem.diagramType, ext, exampleItem.example].join('/');
    const sum = md5(radical);
    const filename = `${sum}.${ext}`;

    if (cache.includes(filename)) {
        return `./cache/${filename}`;
    }
    return `${defaultRenderUrl}${radical}`;
};
