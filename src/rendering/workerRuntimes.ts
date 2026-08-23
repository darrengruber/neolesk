// These assets are generated from the pinned npm packages by prepare-worker-assets.mjs.
// Wrangler turns each .wasm import into a statically compiled workerd module.
import d2Wasm from '../worker/generated/d2.wasm';
import pikchrWasm from '../worker/generated/pikchr.wasm';
import svgbobWasm from '../worker/generated/svgbob.wasm';
import vizWasm from '../worker/generated/viz-graphviz.wasm';
import { createD2DagreEvaluator } from './d2DagreRuntime';

interface D2Runtime {
    compile(input: string): Promise<string> | string;
    render(input: string): Promise<string> | string;
}

interface GoRuntime {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
}

interface VizInstance {
    renderString(source: string, options: { format: string; engine: string }): string;
}

interface VizRuntime {
    instance(): Promise<VizInstance>;
}

type WorkerGlobals = {
    Go?: new () => GoRuntime;
    d2?: D2Runtime;
    Viz?: VizRuntime;
    global?: unknown;
    window?: WorkerGlobals;
    document?: {
        baseURI: string;
        currentScript: null;
        createElement(tag: string): unknown;
        createElementNS(namespace: string, tag: string): unknown;
        head: { appendChild(node: unknown): void };
        body: { appendChild(node: unknown): void; removeChild(node: unknown): void };
    };
    XMLSerializer?: new () => { serializeToString(node: unknown): string };
    __neoleskInstantiateVizWasm?: (imports: WebAssembly.Imports) => Promise<{
        instance: WebAssembly.Instance;
        module: WebAssembly.Module;
    }>;
    eval?: (script: string) => unknown;
};

const workerGlobals = globalThis as unknown as WorkerGlobals;

export const installWorkerPlantUmlPlatform = (): void => {
    if (workerGlobals.window && workerGlobals.document) return;
    const escapeXml = (value: string) => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    class SvgNode {
        readonly attributes = new Map<string, string>();
        readonly children: SvgNode[] = [];
        readonly style: Record<string, string> = {};
        parentNode: SvgNode | null = null;
        textContent = '';

        constructor(readonly tag: string) {}
        get firstChild() { return this.children[0] || null; }
        setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
        setAttributeNS(_namespace: string, name: string, value: string) { this.setAttribute(name, value); }
        getAttribute(name: string) { return this.attributes.get(name) || null; }
        appendChild(node: SvgNode) {
            node.parentNode = this;
            this.children.push(node);
            return node;
        }
        insertBefore(node: SvgNode, reference: SvgNode | null) {
            node.parentNode = this;
            const index = reference ? this.children.indexOf(reference) : -1;
            if (index < 0) this.children.push(node);
            else this.children.splice(index, 0, node);
            return node;
        }
        removeChild(node: SvgNode) {
            const index = this.children.indexOf(node);
            if (index >= 0) this.children.splice(index, 1);
            node.parentNode = null;
            return node;
        }
        getBBox() {
            const size = Number(this.attributes.get('font-size') || 12);
            return { x: 0, y: -size * 0.8, width: Array.from(this.textContent).length * size * 0.6, height: size };
        }
        serialize(): string {
            const attributes = Array.from(this.attributes, ([name, value]) => ` ${name}="${escapeXml(value)}"`).join('');
            const content = `${escapeXml(this.textContent)}${this.children.map((child) => child.serialize()).join('')}`;
            return `<${this.tag}${attributes}>${content}</${this.tag}>`;
        }
    }
    const body = new SvgNode('body');
    const documentShim = {
        baseURI: 'https://worker.invalid/',
        currentScript: null,
        createElement(tag: string) {
            if (tag === 'canvas') {
                return {
                    getContext() {
                        return {
                            font: '12px sans-serif',
                            measureText(text: string) {
                                const size = Number.parseFloat(this.font.match(/[\d.]+px/)?.[0] || '12');
                                return {
                                    width: Array.from(text).length * size * 0.6,
                                    actualBoundingBoxAscent: size * 0.8,
                                    actualBoundingBoxDescent: size * 0.2,
                                };
                            },
                        };
                    },
                };
            }
            return new SvgNode(tag);
        },
        createElementNS(_namespace: string, tag: string) { return new SvgNode(tag); },
        head: { appendChild() {} },
        body,
    };
    workerGlobals.window = workerGlobals;
    workerGlobals.document = documentShim;
    workerGlobals.window.document = documentShim;
    workerGlobals.XMLSerializer = class {
        serializeToString(node: unknown) {
            if (!(node instanceof SvgNode)) throw new Error('Cannot serialize a non-SVG node');
            return node.serialize();
        }
    };
};

let vizReady: Promise<VizRuntime> | null = null;
export const loadWorkerViz = (): Promise<VizRuntime> => {
    if (!vizReady) {
        workerGlobals.__neoleskInstantiateVizWasm = async (imports) => ({
            instance: new WebAssembly.Instance(vizWasm, imports),
            module: vizWasm,
        });
        // @ts-expect-error Generated upstream runtime has no declaration file.
        vizReady = import('../worker/generated/viz-runtime.js').then(() => {
            if (!workerGlobals.Viz) throw new Error('Viz.js did not initialize');
            return workerGlobals.Viz;
        });
    }
    return vizReady;
};

let d2Ready: Promise<D2Runtime> | null = null;
export const loadWorkerD2 = async (): Promise<D2Runtime> => {
    if (!d2Ready) {
        d2Ready = (async () => {
            workerGlobals.eval = createD2DagreEvaluator();
            workerGlobals.global ||= globalThis;
            // @ts-expect-error Generated upstream runtime has no declaration file.
            await import('../worker/generated/d2-wasm-exec.js');
            if (!workerGlobals.Go) throw new Error('D2 Go runtime did not initialize');
            const go = new workerGlobals.Go();
            const instance = new WebAssembly.Instance(d2Wasm, go.importObject);
            void go.run(instance);
            for (let attempt = 0; attempt < 100 && !workerGlobals.d2; attempt += 1) {
                await new Promise<void>((resolve) => queueMicrotask(resolve));
            }
            if (!workerGlobals.d2) throw new Error('D2 runtime did not initialize');
            return workerGlobals.d2;
        })();
    }
    return d2Ready;
};

interface EmscriptenModule {
    ccall(
        name: string,
        returnType: string,
        argumentTypes: string[],
        arguments_: unknown[],
    ): string;
}

let pikchrReady: Promise<EmscriptenModule> | null = null;
export const renderWorkerPikchr = async (source: string): Promise<string> => {
    if (!pikchrReady) {
        // @ts-expect-error Generated upstream runtime has no declaration file.
        pikchrReady = import('../worker/generated/pikchr-runtime.js').then(({ default: createModule }) => (
            createModule({
                instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
                    const instance = new WebAssembly.Instance(pikchrWasm, imports);
                    receive(instance);
                    return instance.exports;
                },
            }) as Promise<EmscriptenModule>
        ));
    }
    const module = await pikchrReady;
    return module.ccall(
        'pikchr',
        'string',
        ['string', 'string', 'number', 'number', 'number'],
        [source, 'neolesk-pikchr', 0, 1, 1],
    );
};

type SvgbobExports = WebAssembly.Exports & {
    memory: WebAssembly.Memory;
    render(returnPointer: number, sourcePointer: number, sourceLength: number): void;
    __wbindgen_add_to_stack_pointer(value: number): number;
    __wbindgen_malloc(size: number): number;
    __wbindgen_realloc(pointer: number, oldSize: number, newSize: number): number;
    __wbindgen_free(pointer: number, size: number): void;
};

let svgbobInstance: SvgbobExports | null = null;
export const renderWorkerSvgbob = (source: string): string => {
    const wasm = svgbobInstance || (new WebAssembly.Instance(svgbobWasm, {}).exports as SvgbobExports);
    svgbobInstance = wasm;
    const encoded = new TextEncoder().encode(source);
    const sourcePointer = wasm.__wbindgen_malloc(encoded.length);
    new Uint8Array(wasm.memory.buffer).set(encoded, sourcePointer);
    const returnPointer = wasm.__wbindgen_add_to_stack_pointer(-16);
    let outputPointer = 0;
    let outputLength = 0;
    try {
        wasm.render(returnPointer, sourcePointer, encoded.length);
        const returned = new Int32Array(wasm.memory.buffer, returnPointer, 2);
        outputPointer = returned[0];
        outputLength = returned[1];
        return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outputPointer, outputLength));
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        if (outputPointer) wasm.__wbindgen_free(outputPointer, outputLength);
    }
};
