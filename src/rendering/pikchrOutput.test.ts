import { describe, expect, it } from 'vitest';
import { pikchrSvgOrThrow } from './pikchrOutput';

describe('pikchrSvgOrThrow', () => {
    it('turns the Pikchr error block into an error with its message and line', () => {
        const block = '<div><pre>\n/*    1 */  box "ok"\n/*    2 */  arrow\n/*    3 */  this is not pikchr ((\n'
            + '                         ^^^^\nERROR: syntax error\n</pre></div>\n';
        expect(() => pikchrSvgOrThrow(block)).toThrow('syntax error (line 3)');
    });

    it('returns SVG unchanged', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        expect(pikchrSvgOrThrow(svg)).toBe(svg);
    });
});
