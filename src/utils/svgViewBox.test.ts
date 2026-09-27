import { describe, expect, it } from 'vitest';
import { ensureViewBox } from './svgViewBox';

describe('ensureViewBox', () => {
    it('adds a viewBox from pixel width and height, so the image can scale', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="576" height="592" class="svgbob"><g/></svg>';
        expect(ensureViewBox(svg)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="576" height="592" class="svgbob" viewBox="0 0 576 592"><g/></svg>');
    });

    it('reads unitless and pt sizes, and leaves an existing viewBox alone', () => {
        expect(ensureViewBox('<svg width="330pt" height="308.5pt">')).toBe('<svg width="330pt" height="308.5pt" viewBox="0 0 330 308.5">');
        const graphviz = '<svg width="227pt" height="416pt" viewBox="0.00 0.00 227.00 416.00">';
        expect(ensureViewBox(graphviz)).toBe(graphviz);
    });

    it('leaves an SVG whose size it cannot read unchanged', () => {
        const relative = '<svg width="100%" height="100%"><g/></svg>';
        expect(ensureViewBox(relative)).toBe(relative);
        expect(ensureViewBox('not an svg')).toBe('not an svg');
    });
});
