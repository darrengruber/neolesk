import mermaid from 'mermaid';
import type { LocalEngine } from './index';

let initialized = false;

const engine: LocalEngine = {
    async render(source: string): Promise<string> {
        if (!initialized) {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose',
            });
            initialized = true;
        }

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, source);
        return svg;
    },
};

export default engine;
