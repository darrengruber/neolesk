import * as vega from 'vega';
import type { LocalEngine } from './index';

const engine: LocalEngine = {
    async render(source: string): Promise<string> {
        const spec = JSON.parse(source);
        const view = new vega.View(vega.parse(spec), { renderer: 'none' });
        return view.toSVG();
    },
};

export default engine;
