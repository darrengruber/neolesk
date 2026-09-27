/**
 * What the PlantUML MIT build returns needs interpretation. It shares these
 * rules between the browser and the session cell, and imports nothing, so the
 * Worker bundle does not grow.
 */

/**
 * PlantUML servers, Kroki included, wrap a diagram body without an `@start...`
 * line in `@startuml`/`@enduml`. The MIT build does not, so it would reject
 * source that the render server draws.
 */
export const wrapPlantUmlSource = (source: string): string => (
    /^\s*@start/m.test(source) ? source : `@startuml\n${source}\n@enduml`
);

const PLANTUML_UNSUPPORTED = 'Diagram not supported by this release of PlantUML';

/**
 * The MIT build omits some diagram types, such as Salt, and draws an
 * explanation instead of failing. Return that as an error, so that ADR 0014's
 * server fallback applies and the explanation is never shown as the diagram.
 */
export const plantUmlUnsupportedError = (svg: string): Error | null => {
    if (!svg.includes(PLANTUML_UNSUPPORTED)) return null;
    const directive = svg.match(/following directive\s*(?:<[^>]*>\s*)*([^<]*?)\s*(?:<[^>]*>\s*)*is not recognized/i)?.[1]
        ?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    return new Error(directive
        ? `The PlantUML MIT build does not support ${directive}. A render server can draw it.`
        : 'The PlantUML MIT build does not support this diagram. A render server can draw it.');
};

/**
 * PlantUML also reports a source error as a picture, not through its failure
 * callback. Read the message and line out of that picture. `lineOffset` removes
 * the line that wrapPlantUmlSource added.
 */
export const plantUmlSourceError = (svg: string, lineOffset = 0): Error | null => {
    const origin = svg.match(/>\[From [^<]*?\(line (\d+)\)\s*\]<\/text>/);
    if (!origin) return null;
    const messages = Array.from(svg.matchAll(/<text\b[^>]*\bfill="#FF0000"[^>]*>([^<]*)<\/text>/g))
        .map((match) => match[1].trim())
        .filter(Boolean);
    if (messages.length === 0) return null;
    return new Error(`${messages.join(' ')} (line ${Math.max(1, Number(origin[1]) - lineOffset)})`);
};
