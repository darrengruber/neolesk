/**
 * Pikchr returns an HTML error block instead of SVG when the source is
 * invalid. Turn that block into an error with the message and line, so that
 * both the browser and the session cell report it as a diagnostic. It imports
 * nothing, so the Worker bundle does not grow.
 */
export const pikchrSvgOrThrow = (output: string): string => {
    if (/^\s*<svg\b/i.test(output)) return output;
    const text = output.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const markers = Array.from(text.matchAll(/\/\*\s*(\d+)\s*\*\//g));
    const line = markers[markers.length - 1]?.[1];
    const message = text.match(/ERROR:\s*(.+)/)?.[1]?.trim() || 'Pikchr could not render the source';
    throw new Error(line ? `${message} (line ${line})` : message);
};
