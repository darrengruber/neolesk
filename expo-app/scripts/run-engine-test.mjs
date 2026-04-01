/**
 * Local engine vs Kroki reference rendering test.
 *
 * For each example with a local rendering engine (mermaid, graphviz,
 * nomnoml, vega, vegalite, wavedrom), this script:
 *
 *   1. Navigates to the app and selects the diagram type + example
 *   2. Screenshots the preview (rendered via local engine)
 *   3. Fetches the kroki reference SVG and screenshots it inline
 *   4. Pixel-diffs the two
 *
 * This catches rendering divergence between local engines and kroki,
 * font differences, layout bugs, and missing features.
 *
 * Output structure (test-results/engines/):
 *   report.json
 *   <diagramType>/<slug>/
 *     local.png      — local engine render
 *     remote.png     — kroki reference render
 *     diff.png       — pixel difference overlay
 *
 * Usage:
 *   node scripts/run-engine-test.mjs
 *
 * Requires:
 *   - Expo dev server running on :8081  (npm run web)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const BASE_URL = process.env.TEST_URL || 'http://localhost:8081';
const KROKI_URL = (process.env.KROKI_URL || 'https://kroki.io/').replace(/\/*$/, '/');
const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'test-results', 'engines');
const MAX_VIEWPORT = 4000;

const LOCAL_ENGINES = new Set([
    'mermaid', 'graphviz', 'nomnoml', 'vega', 'vegalite', 'wavedrom',
]);

// ── Helpers ─────────────────────────────────────────────────────────────

function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function pngFromBuffer(buf) {
    return PNG.sync.read(buf);
}

function diffPngs(aBuf, bBuf) {
    const a = pngFromBuffer(aBuf);
    const b = pngFromBuffer(bBuf);

    const w = Math.max(a.width, b.width);
    const h = Math.max(a.height, b.height);

    const pad = (png) => {
        if (png.width === w && png.height === h) return png.data;
        const out = Buffer.alloc(w * h * 4, 0xFF);
        for (let y = 0; y < png.height; y++) {
            const srcOff = y * png.width * 4;
            const dstOff = y * w * 4;
            png.data.copy(out, dstOff, srcOff, srcOff + png.width * 4);
        }
        return out;
    };

    const aData = pad(a);
    const bData = pad(b);
    const diffImg = new PNG({ width: w, height: h });

    const numDiff = pixelmatch(aData, bData, diffImg.data, w, h, {
        threshold: 0.15,
        includeAA: false,
        alpha: 0.1,
        diffColor: [255, 0, 0],
        diffColorAlt: [255, 165, 0],
    });

    return {
        width: w,
        height: h,
        diffPixels: numDiff,
        diffPercent: +(numDiff / (w * h) * 100).toFixed(3),
        diffPng: PNG.sync.write(diffImg),
    };
}

// ── TS module loader ────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveLocalModule(specifier, importerDir) {
    const candidates = [
        resolve(importerDir, specifier),
        resolve(importerDir, `${specifier}.ts`),
        resolve(importerDir, `${specifier}.js`),
        resolve(importerDir, specifier, 'index.ts'),
        resolve(importerDir, specifier, 'index.js'),
    ];
    const found = candidates.find(c => existsSync(c) && statSync(c).isFile());
    if (!found) throw new Error(`Cannot resolve "${specifier}" from "${importerDir}"`);
    return found;
}

function loadTsModule(modulePath) {
    const resolved = resolve(modulePath);
    if (moduleCache.has(resolved)) return moduleCache.get(resolved);

    const source = readFileSync(resolved, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: resolved,
    });

    const mod = { exports: {} };
    moduleCache.set(resolved, mod.exports);

    const localRequire = (spec) => {
        if (spec.startsWith('.')) return loadTsModule(resolveLocalModule(spec, dirname(resolved)));
        return require(spec);
    };

    const fn = runInThisContext(
        `(function(require,module,exports,__filename,__dirname){${transpiled.outputText}\n})`,
        { filename: resolved },
    );
    fn(localRequire, mod, mod.exports, resolved, dirname(resolved));
    moduleCache.set(resolved, mod.exports);
    return mod.exports;
}

function buildManifest() {
    const examplesMod = loadTsModule(join(ROOT, 'src/examples/index.ts'));
    const examples = examplesMod.default || examplesMod;
    const coderMod = loadTsModule(join(ROOT, 'src/kroki/coder.ts'));
    const decode = coderMod.decode;

    return examples
        .filter((ex) => LOCAL_ENGINES.has(ex.diagramType))
        .map((ex, idx) => ({
            id: idx,
            diagramType: ex.diagramType,
            title: ex.title,
            description: ex.description,
            source: decode(ex.example),
            encoded: ex.example,
            krokiUrl: `${KROKI_URL}${ex.diagramType}/svg/${ex.example}`,
        }));
}

// ── Per-example test ────────────────────────────────────────────────────

async function testExample(page, entry, outDir) {
    const RENDER_WIDTH = 1200;
    const RENDER_HEIGHT = 900;

    // ── Step 1: Render via local engine using the app ────────────────

    // Navigate to the app with this diagram pre-loaded via hash
    const appHash = `#${entry.diagramType}/svg/${entry.encoded}`;
    await page.goto(`${BASE_URL}/${appHash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // let local engine render

    // Check if preview has rendered content
    const previewReady = await page.evaluate(() => {
        const img = document.querySelector('img[src^="blob:"]');
        return !!img;
    });

    if (!previewReady) {
        // Fall back: the local engine may have failed, check for error state
        const hasError = await page.evaluate(() => {
            return !!document.querySelector('[style*="color"]')?.textContent?.includes('Failed');
        });

        if (hasError) {
            return {
                ...entry, status: 'error',
                error: 'Local engine render failed in app',
                diffPercent: 100, diffPixels: 0, width: 0, height: 0,
            };
        }
    }

    // Screenshot the preview pane (the rendered diagram)
    // Wait for any animations/transitions to settle
    await page.waitForTimeout(500);

    // Find the preview image and screenshot it
    const localScreenshot = await page.evaluate(async ({ krokiUrl }) => {
        // Get the locally-rendered SVG blob URL from the preview image
        const img = document.querySelector('img[src^="blob:"]');
        if (!img) return null;

        // Fetch the blob URL to get the SVG text
        const res = await fetch(img.src);
        return await res.text();
    }, { krokiUrl: entry.krokiUrl });

    // ── Step 2: Fetch kroki reference ────────────────────────────────

    const krokiSvg = await page.evaluate(async (url) => {
        try {
            const res = await fetch(url);
            if (!res.ok) return { error: `HTTP ${res.status}` };
            const text = await res.text();
            if (!text.includes('<svg')) return { error: 'Not SVG' };
            return { svg: text };
        } catch (err) {
            return { error: err.message || String(err) };
        }
    }, entry.krokiUrl);

    if (krokiSvg.error) {
        return {
            ...entry, status: 'error',
            error: `Kroki fetch failed: ${krokiSvg.error}`,
            diffPercent: 100, diffPixels: 0, width: 0, height: 0,
        };
    }

    if (!localScreenshot) {
        return {
            ...entry, status: 'error',
            error: 'Could not extract local render SVG',
            diffPercent: 100, diffPixels: 0, width: 0, height: 0,
        };
    }

    // ── Step 3: Render both SVGs at same size and screenshot ─────────

    await page.goto(`${BASE_URL}/test-shim.html`, { waitUntil: 'domcontentloaded' });

    await page.evaluate(({ localSvg, remoteSvg, w, h }) => {
        document.head.innerHTML = `<style>
  * { margin: 0; padding: 0; }
  body { background: #fff; }
  .target { background: #fff; display: inline-block; overflow: hidden; }
  .target svg { display: block; }
</style>`;
        document.body.innerHTML = `
  <div id="local" class="target"></div>
  <div id="remote" class="target" style="position:absolute;left:-99999px;top:0"></div>
`;
        const setSize = (container, svg, width, height) => {
            container.innerHTML = svg;
            const el = container.querySelector('svg');
            if (el) {
                el.setAttribute('width', width);
                el.setAttribute('height', height);
                el.style.width = width + 'px';
                el.style.height = height + 'px';
            }
            container.style.width = width + 'px';
            container.style.height = height + 'px';
        };

        setSize(document.getElementById('local'), localSvg, w, h);
        setSize(document.getElementById('remote'), remoteSvg, w, h);
    }, { localSvg: localScreenshot, remoteSvg: krokiSvg.svg, w: RENDER_WIDTH, h: RENDER_HEIGHT });

    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts.ready);

    const localPng = await page.locator('#local').screenshot({ type: 'png' });
    writeFileSync(join(outDir, 'local.png'), localPng);

    // Swap visibility
    await page.evaluate(() => {
        document.getElementById('local').style.cssText = 'position:absolute;left:-99999px;top:0';
        document.getElementById('remote').style.cssText = 'background:#fff;display:inline-block';
    });
    await page.waitForTimeout(100);

    const remotePng = await page.locator('#remote').screenshot({ type: 'png' });
    writeFileSync(join(outDir, 'remote.png'), remotePng);

    // ── Step 4: Pixel diff ──────────────────────────────────────────

    const { diffPercent, diffPixels, diffPng, width, height } = diffPngs(localPng, remotePng);
    writeFileSync(join(outDir, 'diff.png'), diffPng);

    // Per-engine thresholds — local engines use different libs/versions than kroki
    const thresholds = {
        mermaid:  { pass: 15, warn: 30 },
        graphviz: { pass: 5, warn: 15 },
        nomnoml:  { pass: 10, warn: 25 },
        vega:     { pass: 5, warn: 15 },
        vegalite: { pass: 5, warn: 15 },
        wavedrom: { pass: 5, warn: 15 },
    }[entry.diagramType] || { pass: 5, warn: 15 };

    const status = diffPercent < thresholds.pass ? 'pass'
        : diffPercent < thresholds.warn ? 'warn' : 'fail';

    return {
        id: entry.id,
        diagramType: entry.diagramType,
        title: entry.title,
        description: entry.description,
        status,
        diffPercent,
        diffPixels,
        width,
        height,
        error: null,
    };
}

// ── Main ────────────────────────────────────────────────────────────────

async function run() {
    console.log('[engine-test] Building manifest…');
    const manifest = buildManifest();
    console.log(`[engine-test] ${manifest.length} examples with local engines`);

    const byEngine = {};
    for (const entry of manifest) {
        (byEngine[entry.diagramType] ??= []).push(entry);
    }
    for (const [engine, entries] of Object.entries(byEngine)) {
        console.log(`  ${engine}: ${entries.length} examples`);
    }

    console.log('[engine-test] Launching Chromium…');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: MAX_VIEWPORT, height: MAX_VIEWPORT },
        deviceScaleFactor: 1,
    });

    const results = [];
    let passCount = 0, warnCount = 0, failCount = 0, errorCount = 0;

    for (const entry of manifest) {
        const slug = slugify(`${entry.title}-${entry.description}`);
        const dir = join(OUT_DIR, entry.diagramType, slug);
        mkdirSync(dir, { recursive: true });

        const page = await context.newPage();
        try {
            const result = await testExample(page, entry, dir);
            results.push(result);

            const icon = { pass: '✓', warn: '⚠', fail: '✗', error: '!' }[result.status];
            const detail = result.error || `${result.diffPercent.toFixed(1)}% diff`;
            console.log(`  ${icon} [${entry.diagramType}] ${entry.title} — ${detail}`);

            if (result.status === 'pass') passCount++;
            else if (result.status === 'warn') warnCount++;
            else if (result.status === 'error') errorCount++;
            else failCount++;
        } catch (err) {
            results.push({
                ...entry, status: 'error', error: err.message,
                diffPercent: 100, diffPixels: 0, width: 0, height: 0,
            });
            errorCount++;
            console.log(`  ! [${entry.diagramType}] ${entry.title} — ERROR: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // ── Report ───────────────────────────────────────────────────────

    const report = {
        timestamp: new Date().toISOString(),
        krokiUrl: KROKI_URL,
        total: results.length,
        passed: passCount,
        warnings: warnCount,
        failures: failCount,
        errors: errorCount,
        examples: results,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    // ── Summary ──────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  LOCAL ENGINE vs KROKI REFERENCE');
    console.log(`  ${results.length} examples · ${passCount} pass · ${warnCount} warn · ${failCount} fail · ${errorCount} error`);
    console.log('══════════════════════════════════════════════════════');

    const engineSummary = {};
    for (const r of results) {
        const s = (engineSummary[r.diagramType] ??= { pass: 0, warn: 0, fail: 0, error: 0, diffs: [] });
        s[r.status]++;
        if (!r.error) s.diffs.push(r.diffPercent);
    }
    console.log('\nPer-engine breakdown:');
    for (const [engine, s] of Object.entries(engineSummary).sort()) {
        const avg = s.diffs.length ? (s.diffs.reduce((a, b) => a + b, 0) / s.diffs.length).toFixed(1) : 'n/a';
        const max = s.diffs.length ? Math.max(...s.diffs).toFixed(1) : 'n/a';
        console.log(`  ${engine}: ${s.pass}p/${s.warn}w/${s.fail}f/${s.error}e — avg ${avg}% max ${max}% diff`);
    }

    if (failCount > 0) {
        console.log('\nFAILURES:');
        for (const r of results.filter(r => r.status === 'fail'))
            console.log(`  ✗ [${r.diagramType}] ${r.title}: ${r.diffPercent.toFixed(1)}% diff`);
    }

    if (errorCount > 0) {
        console.log('\nERRORS:');
        for (const r of results.filter(r => r.status === 'error'))
            console.log(`  ! [${r.diagramType}] ${r.title}: ${r.error}`);
    }

    const sorted = [...results].filter(r => !r.error).sort((a, b) => b.diffPercent - a.diffPercent);
    console.log('\nWorst diffs:');
    for (const r of sorted.slice(0, 10))
        console.log(`  ${r.diffPercent.toFixed(1)}%  [${r.diagramType}] ${r.title}`);

    console.log(`\nFull report: test-results/engines/report.json\n`);

    process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
    console.error('[engine-test] Fatal:', err.message);
    process.exit(2);
});
