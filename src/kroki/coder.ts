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
const encodeBase64 = (value: string): string => {
    if (typeof globalThis.btoa === 'function') {
        return globalThis.btoa(value);
    }

    if (typeof Buffer !== 'undefined') {
        return Buffer.from(value, 'binary').toString('base64');
    }

    throw new Error('Base64 encoding is not available.');
};

const decodeBase64 = (value: string): string => {
    if (typeof globalThis.atob === 'function') {
        return globalThis.atob(value);
    }

    if (typeof Buffer !== 'undefined') {
        return Buffer.from(value, 'base64').toString('binary');
    }

    throw new Error('Base64 decoding is not available.');
};

export const encode = (source: string): string => {
    if (!TextEncoderRef) {
        throw new Error('TextEncoder is not available.');
    }

    const data = new TextEncoderRef().encode(source);
    const compressed = [...pako.deflate(data, { level: 9 })].map((value) => String.fromCharCode(value)).join('');
    return encodeBase64(compressed).replace(/\+/g, '-').replace(/\//g, '_');
};

export const decode = (coded: string): string => {
    const compressed = decodeBase64(coded.replace(/-/g, '+').replace(/_/g, '/'));
    return pako.inflate(compressed.split('').map((char) => char.charCodeAt(0)), { to: 'string' });
};

if (typeof window !== 'undefined') {
    window.coder = { encode, decode };
    window.pako = pako;
}
