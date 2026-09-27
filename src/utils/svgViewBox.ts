/**
 * Some renderers (svgbob, the blockdiag family) write an SVG root with a
 * width and height but no viewBox. Such an SVG cannot scale inside an <img>:
 * a thumbnail shows its top-left corner instead of the whole diagram. Add the
 * viewBox the size implies; leave anything else unchanged.
 */
export const ensureViewBox = (svg: string): string => {
    const root = /<svg\b[^>]*>/i.exec(svg);
    if (!root || /\bviewBox\s*=/i.test(root[0])) return svg;
    const size = (name: string) => {
        const match = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9]*\\.?[0-9]+)\\s*(px|pt)?\\s*["']`, 'i').exec(root[0]);
        return match ? match[1] : null;
    };
    const width = size('width');
    const height = size('height');
    if (!width || !height) return svg;
    const tag = root[0].replace(/\s*\/?>$/, (end) => ` viewBox="0 0 ${width} ${height}"${end.trim() === '/>' ? '/>' : '>'}`);
    return svg.slice(0, root.index) + tag + svg.slice(root.index + root[0].length);
};
