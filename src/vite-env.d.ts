/// <reference types="vite/client" />

declare module 'pako';

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

interface Window {
    config?: {
        krokiEngineUrl?: string;
    };
}
