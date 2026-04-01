import type { KrokiError } from '../types';

const lineNumberPatterns = [
    /\(line:\s*(\d+)\)/,             // PlantUML: (line: 1)
    /line:\s*(\d+)/,                 // PlantUML variant: line: 1
    /syntax error in line\s+(\d+)/i, // Graphviz
    /Parse error on line\s+(\d+)/i,  // Mermaid
    /at line\s+(\d+)/i,             // nomnoml/generic: at line 19
    /line\s+(\d+)\s+col/i,          // line 5 column 3
    /line\s+(\d+):/,                // D2: line 1:
    /line\s+(\d+)/i,                // Generic fallback
];

/**
 * Extract the first meaningful error line from a Kroki error response.
 * Strips the "Error NNN:" prefix, stack traces, exit codes, and
 * engine-specific noise to return only the syntax-level message.
 */
const extractMessage = (body: string): string => {
    const stripped = body.replace(/^Error\s+\d+:\s*/, '');

    // Find the core error line — the first line that looks like a parse/syntax error
    const lines = stripped.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Stop at stack traces, exit codes, blank noise
        if (/^\s+at\s+/.test(line)) break;
        if (/^\(exit code/i.test(trimmed)) break;
        if (/^Node\.js\s+v/i.test(trimmed)) break;
        // Skip lines that are just a caret pointer (like "            ^")
        if (/^\s*\^\s*$/.test(line)) continue;
        // Skip file paths from stack-like first lines (e.g. "/snapshot/app/node_modules/...")
        if (/^\//.test(trimmed) && trimmed.includes('node_modules')) continue;
        return trimmed;
    }

    // Fallback: first non-empty line
    const fallback = lines.find((l) => l.trim())?.trim();
    return fallback || stripped.trim();
};

export const parseKrokiError = (body: string): KrokiError => {
    const message = extractMessage(body);

    for (const pattern of lineNumberPatterns) {
        const match = body.match(pattern);
        if (match) {
            return { message, lineNumber: parseInt(match[1], 10) };
        }
    }

    return { message, lineNumber: null };
};
