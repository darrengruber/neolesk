import nomnoml from 'nomnoml';
import type { LocalEngine } from './index';

const engine: LocalEngine = {
    async render(source: string): Promise<string> {
        return nomnoml.renderSvg(source);
    },
};

export default engine;
