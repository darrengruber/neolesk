import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn();
const layout = vi.fn();

vi.mock('@softwaretechnik/dbml-renderer', () => ({ run }));
vi.mock('@hpcc-js/wasm-graphviz', () => ({
    Graphviz: { load: vi.fn(async () => ({ layout })) },
}));

describe('DBML browser renderer', () => {
    beforeEach(() => {
        run.mockReset();
        layout.mockReset();
    });

    it('converts DBML to DOT before using the browser-safe Graphviz renderer', async () => {
        run.mockReturnValue('digraph { users }');
        layout.mockReturnValue('<svg aria-label="users"></svg>');

        const renderer = await (await import('./dbml')).load();
        const svg = await renderer.render({ source: 'Table users { id integer }', format: 'svg' });

        expect(run).toHaveBeenCalledWith('Table users { id integer }', 'dot');
        expect(layout).toHaveBeenCalledWith('digraph { users }', 'svg', 'dot');
        expect(svg).toContain('<svg');
    });
});
