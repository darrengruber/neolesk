/// <reference types="vite/client" />

declare module 'pako';
declare module '*.wasm' {
    const module: WebAssembly.Module;
    export default module;
}

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;
declare const __KROKI_ENGINE_URL__: string;
declare const __PLANTUML_VIZ_URL__: string;
