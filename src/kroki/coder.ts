import pako from 'pako';

declare global {
    interface Window {
        coder?: {
            encode: (source: string) => string;
            decode: (coded: string) => string;
        };
        pako?: typeof pako;
    }
}

const TextEncoderRef = globalThis.TextEncoder;

export const encode = (source: string): string => {
    if (!TextEncoderRef) {
        throw new Error('TextEncoder is not available.');
    }

    const data = new TextEncoderRef().encode(source);
    const compressed = [...pako.deflate(data, { level: 9 })].map((value) => String.fromCharCode(value)).join('');
    return btoa(compressed).replace(/\+/g, '-').replace(/\//g, '_');
};

export const decode = (coded: string): string => {
    const compressed = atob(coded.replace(/-/g, '+').replace(/_/g, '/'));
    return pako.inflate(compressed.split('').map((char) => char.charCodeAt(0)), { to: 'string' });
};

if (typeof window !== 'undefined') {
    window.coder = { encode, decode };
    window.pako = pako;
}
