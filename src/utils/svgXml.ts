/**
 * SVG is XML, and XML defines only five named entities. Renderers that write
 * HTML labels (Mermaid, both in the browser and on Kroki) emit HTML entities
 * such as &nbsp;, and an <img>, a saved .svg file or any XML parser then
 * refuses the whole document. Rewrite each HTML named entity as its numeric
 * reference, and escape one we do not know, so the text survives and the
 * document parses.
 */
const xmlEntities = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

// Latin-1 (160–255) in code point order, then the common punctuation and symbols.
const latin1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr '
    + 'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
    + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml '
    + 'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
    + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml '
    + 'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

const htmlEntities = new Map<string, number>([
    ...latin1.split(' ').map((name, index): [string, number] => [name, 160 + index]),
    ['ensp', 8194], ['emsp', 8195], ['thinsp', 8201], ['zwnj', 8204], ['zwj', 8205],
    ['ndash', 8211], ['mdash', 8212], ['lsquo', 8216], ['rsquo', 8217], ['sbquo', 8218],
    ['ldquo', 8220], ['rdquo', 8221], ['bdquo', 8222], ['dagger', 8224], ['Dagger', 8225],
    ['bull', 8226], ['hellip', 8230], ['permil', 8240], ['prime', 8242], ['Prime', 8243],
    ['lsaquo', 8249], ['rsaquo', 8250], ['euro', 8364], ['trade', 8482],
    ['larr', 8592], ['uarr', 8593], ['rarr', 8594], ['darr', 8595], ['harr', 8596],
    ['lArr', 8656], ['rArr', 8658], ['hArr', 8660],
    ['minus', 8722], ['infin', 8734], ['ne', 8800], ['le', 8804], ['ge', 8805],
    ['alpha', 945], ['beta', 946], ['gamma', 947], ['delta', 948], ['lambda', 955],
    ['mu', 956], ['pi', 960], ['sigma', 963], ['omega', 969],
]);

export const xmlSafeSvg = (svg: string): string => (
    svg.includes('&')
        ? svg.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (match, name: string) => {
            if (xmlEntities.has(name)) return match;
            const code = htmlEntities.get(name);
            return code === undefined ? `&amp;${name};` : `&#${code};`;
        })
        : svg
);
