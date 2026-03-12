import * as vega from 'vega';
import * as vl from 'vega-lite';
import type { LocalEngine } from './index';

const engine: LocalEngine = {
    async render(source: string): Promise<string> {
        const vlSpec = JSON.parse(source);
        const vegaSpec = vl.compile(vlSpec).spec;
        const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' });
        return view.toSVG();
    },
};

export default engine;
