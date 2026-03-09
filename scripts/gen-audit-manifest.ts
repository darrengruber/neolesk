/**
 * Generate audit-manifest.json for the browser-based svg2pdf audit.
 * Usage: npx tsx scripts/gen-audit-manifest.ts
 */
import { writeFileSync } from 'node:fs';
import examples from '../src/examples';
import { getExampleCacheFilename } from '../src/examples/cacheKey';

const manifest = examples.map(ex => ({
    diagramType: ex.diagramType,
    name: ex.title || ex.description || ex.diagramType,
    file: getExampleCacheFilename(ex),
}));

writeFileSync('public/audit-manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Generated audit-manifest.json with ${manifest.length} entries`);
