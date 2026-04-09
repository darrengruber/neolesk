import { renderAny, onml, waveSkin } from 'wavedrom';
import type { LocalEngine } from './index';

/** WaveDrom examples use JS object literals (unquoted keys), not strict JSON. */
const parseRelaxedJson = (source: string): unknown => {
    try {
        return JSON.parse(source);
    } catch {
        // Fallback: evaluate as a JS expression (safe for object literals)
        // eslint-disable-next-line no-new-func
        return new Function(`return (${source})`)();
    }
};

const engine: LocalEngine = {
    async render(source: string): Promise<string> {
        const parsed = parseRelaxedJson(source);
        const tree = renderAny(0, parsed, waveSkin);
        return onml.stringify(tree);
    },
};

export default engine;
