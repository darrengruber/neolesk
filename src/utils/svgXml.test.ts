import { describe, expect, it } from 'vitest';
import { xmlSafeSvg } from './svgXml';

const parses = (svg: string) => !new DOMParser()
    .parseFromString(svg, 'image/svg+xml')
    .querySelector('parsererror');

// Mermaid (in the browser and on Kroki) writes HTML labels inside
// <foreignObject>, and serialises a non-breaking space as &nbsp;.
const mermaidLabel = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">'
    + '<span class="nodeLabel"><p>After the fix&nbsp;&nbsp;</p></span></div></foreignObject></svg>';

describe('xmlSafeSvg', () => {
    it('turns &nbsp; into its numeric form, so the SVG parses as XML', () => {
        expect(parses(mermaidLabel)).toBe(false);
        const safe = xmlSafeSvg(mermaidLabel);
        expect(safe).toContain('After the fix&#160;&#160;');
        expect(parses(safe)).toBe(true);
    });

    it('converts other HTML named entities and keeps the five XML ones', () => {
        expect(xmlSafeSvg('<text>&copy; &mdash; &hellip; &amp; &lt; &gt; &quot; &apos;</text>'))
            .toBe('<text>&#169; &#8212; &#8230; &amp; &lt; &gt; &quot; &apos;</text>');
    });

    it('escapes an unknown named entity, so the SVG still parses', () => {
        const safe = xmlSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>a &notAnEntity; b</text></svg>');
        expect(safe).toContain('a &amp;notAnEntity; b');
        expect(parses(safe)).toBe(true);
    });

    it('leaves numeric references, CDATA-free text and valid SVG unchanged', () => {
        const valid = '<svg xmlns="http://www.w3.org/2000/svg"><text>&#160;&#xA0; plain</text></svg>';
        expect(xmlSafeSvg(valid)).toBe(valid);
    });
});
