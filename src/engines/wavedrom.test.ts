import { describe, expect, it } from 'vitest';
import { load } from './wavedrom';

describe('WaveDrom renderer', () => {
    it('accepts WaveJSON/JSON5 source used by the official examples', async () => {
        const renderer = await load();
        const svg = await renderer.render({
            source: `{ signal: [
                { name: 'clk', wave: 'p.....|...' },
                { name: 'Data', wave: 'x.345x|=.x', data: ['head', 'body'] },
            ]}`,
            format: 'svg',
        });

        expect(svg).toContain('<svg');
        expect(svg).toContain('clk');
    });
});
