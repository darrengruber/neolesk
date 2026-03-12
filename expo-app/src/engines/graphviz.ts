import { Graphviz } from '@hpcc-js/wasm-graphviz';
import type { LocalEngine } from './index';

let instance: Awaited<ReturnType<typeof Graphviz.load>> | null = null;

const engine: LocalEngine = {
    async render(source: string): Promise<string> {
        if (!instance) {
            instance = await Graphviz.load();
        }
        return instance.dot(source);
    },
};

export default engine;
