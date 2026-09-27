import { describe, expect, it, vi } from 'vitest';
import { entryScriptOf, looksLikeMissingCode, newBuildAvailable } from './appVersion';

const page = (entry: string) => `<!DOCTYPE html><html><head>
    <script type="module" crossorigin src="${entry}"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-abc.js">
  </head><body><div id="root"></div></body></html>`;

describe('entryScriptOf', () => {
    it('finds the module entry script whatever the attribute order', () => {
        expect(entryScriptOf(page('/assets/index-AAAA1111.js'))).toBe('/assets/index-AAAA1111.js');
        expect(entryScriptOf('<script src="/assets/index-B.js" type="module"></script>')).toBe('/assets/index-B.js');
    });

    it('returns null for a page without one', () => {
        expect(entryScriptOf('<html><body>maintenance</body></html>')).toBeNull();
    });
});

describe('newBuildAvailable', () => {
    const running = () => '/assets/index-AAAA1111.js';

    it('is true when the deployed page loads another entry script', async () => {
        const fetchImpl = vi.fn(async () => new Response(page('/assets/index-BBBB2222.js'), { headers: { 'content-type': 'text/html' } }));
        await expect(newBuildAvailable({ fetchImpl, running })).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
    });

    it('is false for the same build, a failed request, or an unrecognisable page', async () => {
        await expect(newBuildAvailable({ fetchImpl: async () => new Response(page('/assets/index-AAAA1111.js')), running })).resolves.toBe(false);
        await expect(newBuildAvailable({ fetchImpl: async () => { throw new TypeError('offline'); }, running })).resolves.toBe(false);
        await expect(newBuildAvailable({ fetchImpl: async () => new Response('oops', { status: 502 }), running })).resolves.toBe(false);
        await expect(newBuildAvailable({ fetchImpl: async () => new Response('<html></html>'), running })).resolves.toBe(false);
    });

    it('is false in development, where there is no built entry script', async () => {
        const fetchImpl = vi.fn();
        await expect(newBuildAvailable({ fetchImpl, running: () => null })).resolves.toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('looksLikeMissingCode', () => {
    it('recognises the errors an old tab meets after a deploy', () => {
        for (const message of [
            "'text/html' is not a valid JavaScript MIME type.",
            'Failed to fetch dynamically imported module: https://example.test/assets/mermaid-A.js',
            'Importing a module script failed.',
            'error loading dynamically imported module',
            "undefined is not an object (evaluating 'd2.compile')",
            "Cannot read properties of undefined (reading 'compile')",
        ]) expect(looksLikeMissingCode(new Error(message)), message).toBe(true);
    });

    it('ignores ordinary diagram errors, which a reload cannot fix', () => {
        for (const message of [
            "syntax error in line 1 near '}'",
            'plantuml needs a render server, but none has consent',
            'syntax error (line 3)',
        ]) expect(looksLikeMissingCode(new Error(message)), message).toBe(false);
    });
});
