/**
 * Visual regression test for the SVG → PNG export pipeline.
 *
 * For every cached example SVG this script:
 *   1. Renders the SVG inline in the DOM (ground truth — foreignObject works)
 *   2. Renders via the canvas export pipeline (what the user gets on PNG export)
 *   3. Pixel-diffs the two using pixelmatch
 *   4. Outputs per-example images + a machine-readable report
 *
 * Output structure (test-results/):
 *   report.json                        — full results with per-example metrics
 *   <diagramType>/<slug>/
 *     reference.png                    — inline SVG screenshot (ground truth)
 *     export.png                       — canvas pipeline output
 *     diff.png                         — red overlay of differing pixels
 *
 * Usage:
 *   node scripts/run-export-test.mjs
 *
 * Requires:
 *   - Expo dev server running on :8081
 *   - Cached SVGs in public/cache/ (npm run examples:cache)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const BASE_URL = 'http://localhost:8081';
const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'test-results');
// Max viewport size — we resize per-example so both reference and export
// render at the SVG's natural pixel dimensions for a fair comparison.
const MAX_VIEWPORT = 4000;

// ── Helpers ─────────────────────────────────────────────────────────────

function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function pngFromBuffer(buf) {
    return PNG.sync.read(buf);
}

function diffPngs(refBuf, expBuf) {
    const ref = pngFromBuffer(refBuf);
    const exp = pngFromBuffer(expBuf);

    // Normalize to same dimensions (pad smaller with white)
    const w = Math.max(ref.width, exp.width);
    const h = Math.max(ref.height, exp.height);

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

    const refData = pad(ref);
    const expData = pad(exp);
    const diffImg = new PNG({ width: w, height: h });

    const numDiff = pixelmatch(refData, expData, diffImg.data, w, h, {
        threshold: 0.1,        // perceptual color threshold (0 = exact, 1 = anything)
        includeAA: false,      // ignore anti-aliasing differences
        alpha: 0.1,            // opacity of unchanged pixels in diff image
        diffColor: [255, 0, 0],
        diffColorAlt: [255, 165, 0],
    });

    const totalPixels = w * h;
    return {
        width: w,
        height: h,
        diffPixels: numDiff,
        diffPercent: +(numDiff / totalPixels * 100).toFixed(3),
        diffPng: PNG.sync.write(diffImg),
    };
}

// ── Manifest builder (loads TS examples without bundler) ────────────────

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
    const cacheDir = join(ROOT, 'public', 'cache');
    const examplesMod = loadTsModule(join(ROOT, 'src/examples/index.ts'));
    const examples = examplesMod.default || examplesMod;
    const { getExampleCacheFilename } = loadTsModule(join(ROOT, 'src/examples/cacheKey.ts'));

    return examples.map((ex, idx) => {
        const filename = getExampleCacheFilename(ex);
        return {
            id: idx,
            diagramType: ex.diagramType,
            title: ex.title,
            description: ex.description,
            filename,
        };
    }).filter(e => existsSync(join(cacheDir, e.filename)));
}

// ── Main ────────────────────────────────────────────────────────────────

async function run() {
    // Build manifest from examples + cache
    console.log('[vrt] Building manifest…');
    const manifest = buildManifest();

    console.log(`[vrt] ${manifest.length} examples to test`);
    console.log('[vrt] Launching Chromium…');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: MAX_VIEWPORT, height: MAX_VIEWPORT },
        deviceScaleFactor: 1,
    });

    const results = [];
    let passCount = 0, warnCount = 0, failCount = 0;

    for (let i = 0; i < manifest.length; i++) {
        const entry = manifest[i];
        const slug = slugify(`${entry.title}-${entry.description}`);
        const dir = join(OUT_DIR, entry.diagramType, slug);
        mkdirSync(dir, { recursive: true });

        const page = await context.newPage();
        try {
            const result = await testExample(page, entry, dir);
            results.push(result);

            const icon = result.status === 'pass' ? '✓' : result.status === 'warn' ? '⚠' : '✗';
            const pct = result.diffPercent.toFixed(1);
            const tag = result.hasForeignObject ? ' [FO]' : '';
            console.log(`  ${icon} [${entry.diagramType}] ${entry.title} — ${entry.description}${tag}  ${pct}% diff  (tier ${result.tier})`);

            if (result.status === 'pass') passCount++;
            else if (result.status === 'warn') warnCount++;
            else failCount++;
        } catch (err) {
            const result = {
                id: entry.id,
                diagramType: entry.diagramType,
                title: entry.title,
                description: entry.description,
                status: 'fail',
                error: err.message,
                diffPercent: 100,
                diffPixels: 0,
                tier: 0,
                hasForeignObject: false,
                width: 0,
                height: 0,
            };
            results.push(result);
            failCount++;
            console.log(`  ✗ [${entry.diagramType}] ${entry.title} — ERROR: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // ── Write report ────────────────────────────────────────────────────

    const report = {
        timestamp: new Date().toISOString(),
        total: results.length,
        passed: passCount,
        warnings: warnCount,
        failures: failCount,
        thresholds: { pass: 1.0, warn: 5.0 },
        examples: results,
    };

    writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    // ── Console summary ─────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════════════════════');
    console.log(`  VISUAL REGRESSION TEST`);
    console.log(`  ${results.length} examples · ${passCount} pass · ${warnCount} warn · ${failCount} fail`);
    console.log(`  Thresholds: pass <1% diff, warn <5%, fail ≥5%`);
    console.log('══════════════════════════════════════════════════════');

    if (failCount > 0) {
        console.log('\nFAILURES (≥5% diff):');
        for (const r of results.filter(r => r.status === 'fail')) {
            console.log(`  ✗ [${r.diagramType}] ${r.title} — ${r.description}`);
            console.log(`    ${r.diffPercent}% diff · ${r.diffPixels} pixels · tier ${r.tier}${r.error ? ' · ' + r.error : ''}`);
        }
    }

    if (warnCount > 0) {
        console.log('\nWARNINGS (1-5% diff):');
        for (const r of results.filter(r => r.status === 'warn')) {
            console.log(`  ⚠ [${r.diagramType}] ${r.title} — ${r.description}`);
            console.log(`    ${r.diffPercent}% diff · ${r.diffPixels} pixels · tier ${r.tier}`);
        }
    }

    // Tier breakdown
    const tierCounts = {};
    for (const r of results) tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1;
    console.log('\nRender tiers:');
    for (const [t, c] of Object.entries(tierCounts).sort())
        console.log(`  Tier ${t}: ${c} examples`);

    // Worst diffs
    const sorted = [...results].sort((a, b) => b.diffPercent - a.diffPercent);
    console.log('\nWorst diffs:');
    for (const r of sorted.slice(0, 10)) {
        console.log(`  ${r.diffPercent.toFixed(1)}%  [${r.diagramType}] ${r.title} — ${r.description}`);
    }

    console.log(`\nFull report: test-results/report.json`);
    console.log(`Per-example images: test-results/<type>/<slug>/\n`);

    process.exit(failCount > 0 ? 1 : 0);
}

// ── Per-example test ────────────────────────────────────────────────────

async function testExample(page, entry, outDir) {
    const svgUrl = `${BASE_URL}/cache/${entry.filename}`;

    // Navigate to an HTML page on the dev server (same-origin for fetch)
    await page.goto(`${BASE_URL}/test-shim.html`, { waitUntil: 'domcontentloaded' });

    // Inject test harness
    await page.evaluate((args) => {
        const { svgUrl, pipelineCode } = args;

        document.head.innerHTML = `<style>
  * { margin: 0; padding: 0; }
  body { background: #fff; }
  #reference, #export {
    background: #fff;
    display: inline-block;
  }
  #reference svg { display: block; }
  #export canvas { display: block; }
</style>`;
        document.body.innerHTML = '<div id="reference"></div><div id="export"></div>';

        // Inject pipeline functions
        const script = document.createElement('script');
        script.textContent = pipelineCode;
        document.body.appendChild(script);

        // Run the test
        window.__testResult = (async () => {
            const res = await fetch(svgUrl);
            const svgText = await res.text();
            const dims = parseSvgDimensions(svgText);
            const hasFO = svgText.includes('<foreignObject');

            // Reference: inline SVG at its natural pixel dimensions
            const refEl = document.getElementById('reference');
            refEl.style.width = dims.width + 'px';
            refEl.style.height = dims.height + 'px';
            refEl.innerHTML = svgText;
            const svgEl = refEl.querySelector('svg');
            if (svgEl) {
                // Force the SVG to render at exactly the parsed dimensions
                svgEl.setAttribute('width', dims.width);
                svgEl.setAttribute('height', dims.height);
                svgEl.style.width = dims.width + 'px';
                svgEl.style.height = dims.height + 'px';
                svgEl.style.display = 'block';
            }

            // Export: canvas pipeline at the same natural dimensions (scale=1)
            // Pre-process ALL SVGs: strip processing instructions and DOCTYPE
            let processed = sanitizeSvg(svgText);
            const hasFOProcessed = processed.includes('<foreignObject');

            let canvas, tier = 0;
            if (!hasFOProcessed) {
                canvas = await renderToCanvas(processed, dims.width, dims.height, 1);
                tier = 1;
            } else {
                try {
                    const inlined = inlineForeignObjectStyles(processed);
                    canvas = await renderToCanvas(inlined, dims.width, dims.height, 1);
                    tier = 2;
                } catch {
                    const stripped = stripForeignObjects(processed);
                    canvas = await renderToCanvas(stripped, dims.width, dims.height, 1);
                    tier = 3;
                }
            }

            // Display canvas at its natural size (no CSS scaling)
            const expEl = document.getElementById('export');
            expEl.style.width = canvas.width + 'px';
            expEl.style.height = canvas.height + 'px';
            expEl.appendChild(canvas);

            await new Promise(r => setTimeout(r, 100));
            await document.fonts.ready;

            return { tier, hasFO, width: dims.width, height: dims.height };
        })();
    }, { svgUrl: `/cache/${entry.filename}`, pipelineCode: exportPipelineFunctions() });

    // Wait for the test to complete
    const { tier, hasFO, width, height } = await page.evaluate(() => window.__testResult);

    // Wait for rendering to stabilize
    await page.waitForTimeout(200);

    // Screenshot reference (inline SVG)
    const refEl = page.locator('#reference');
    const refScreenshot = await refEl.screenshot({ type: 'png' });
    writeFileSync(join(outDir, 'reference.png'), refScreenshot);

    // Screenshot export (canvas)
    const expEl = page.locator('#export');
    const expScreenshot = await expEl.screenshot({ type: 'png' });
    writeFileSync(join(outDir, 'export.png'), expScreenshot);

    // Pixel diff
    const { diffPercent, diffPixels, diffPng, width: dw, height: dh } = diffPngs(refScreenshot, expScreenshot);
    writeFileSync(join(outDir, 'diff.png'), diffPng);

    const status = diffPercent < 1.0 ? 'pass' : diffPercent < 5.0 ? 'warn' : 'fail';

    return {
        id: entry.id,
        diagramType: entry.diagramType,
        title: entry.title,
        description: entry.description,
        status,
        diffPercent,
        diffPixels,
        tier,
        hasForeignObject: hasFO,
        width: dw,
        height: dh,
        error: null,
    };
}

// ── Inlined export pipeline functions ───────────────────────────────────
// These are injected into each test page so the canvas export runs in the
// browser, exactly as it would in the real app.

function exportPipelineFunctions() {
    return `
const toPx = (value) => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return 0;
    const unit = value.replace(/^[\\\\d.]+/, '').trim().toLowerCase();
    switch (unit) {
        case 'pt': return num * (96 / 72);
        case 'pc': return num * 16;
        case 'in': return num * 96;
        case 'cm': return num * (96 / 2.54);
        case 'mm': return num * (96 / 25.4);
        case 'em': return num * 16;
        default: return num;
    }
};

const parseSvgDimensions = (svgText) => {
    const wm = svgText.match(/<svg[^>]*\\\\bwidth=['"]([^'"]+)['"]/);
    const hm = svgText.match(/<svg[^>]*\\\\bheight=['"]([^'"]+)['"]/);
    if (wm && hm) {
        const w = toPx(wm[1]);
        const h = toPx(hm[1]);
        if (w > 0 && h > 0) return { width: w, height: h };
    }
    const vb = svgText.match(/<svg[^>]*\\\\bviewBox=['"]([^'"]+)['"]/);
    if (vb) {
        const parts = vb[1].split(/[\\\\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0)
            return { width: parts[2], height: parts[3] };
    }
    return { width: 800, height: 600 };
};

const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
});

const sanitizeSvg = (svgText) => {
    let cleaned = svgText.replace(/<\\?[^?]*\\?>/g, '');
    cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '').trim();
    if (cleaned.includes('<svg') && !cleaned.match(/<svg[^>]*xmlns\\s*=/)) {
        cleaned = cleaned.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    cleaned = cleaned.replace(/(<svg[^>]*)\\swidth=['"][^'"]*%['"]/i, '$1');
    cleaned = cleaned.replace(/(<svg[^>]*)\\sheight=['"][^'"]*%['"]/i, '$1');
    cleaned = cleaned.replace(
        /(<svg[^>]*style=['"])([^'"]*)(max-width:\\s*[^;'"]+;?\\s*)([^'"]*['"])/i,
        function(_, before, pre, _mw, after) { return before + pre + after; }
    );
    return cleaned;
};

const SVG_PRESENTATION_ATTRS = {
    'fill': 'fill', 'fill-opacity': 'fill-opacity', 'fill-rule': 'fill-rule',
    'stroke': 'stroke', 'stroke-width': 'stroke-width', 'stroke-opacity': 'stroke-opacity',
    'stroke-linecap': 'stroke-linecap', 'stroke-linejoin': 'stroke-linejoin',
    'stroke-miterlimit': 'stroke-miterlimit', 'stroke-dasharray': 'stroke-dasharray',
    'stroke-dashoffset': 'stroke-dashoffset', 'opacity': 'opacity',
    'font-family': 'font-family', 'font-size': 'font-size', 'font-weight': 'font-weight',
    'font-style': 'font-style', 'font-variant': 'font-variant', 'font-stretch': 'font-stretch',
    'text-anchor': 'text-anchor', 'text-decoration': 'text-decoration',
    'dominant-baseline': 'dominant-baseline', 'alignment-baseline': 'alignment-baseline',
    'letter-spacing': 'letter-spacing', 'word-spacing': 'word-spacing',
    'color': 'color', 'display': 'display', 'visibility': 'visibility', 'overflow': 'overflow',
    'marker': 'marker', 'marker-start': 'marker-start', 'marker-mid': 'marker-mid',
    'marker-end': 'marker-end', 'clip-rule': 'clip-rule', 'text-align': 'text-align',
};

const inlineAllStyles = (svgText) => {
    if (!svgText.includes('<style')) return svgText;

    // Try XML parser first to preserve SVG namespaces
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');

    if (parseError) {
        // Fall back to HTML parser for malformed SVGs
        return inlineAllStylesFallback(svgText);
    }

    const svgEl = doc.documentElement;
    if (svgEl.tagName !== 'svg') return svgText;

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    document.body.appendChild(container);
    const importedSvg = document.importNode(svgEl, true);
    container.appendChild(importedSvg);

    try {
        return _inlineStylesOnElement(importedSvg, svgText);
    } finally {
        document.body.removeChild(container);
    }
};

const inlineAllStylesFallback = (svgText) => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);
    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;
        return _inlineStylesOnElement(svgEl, svgText);
    } finally {
        document.body.removeChild(container);
    }
};

const _inlineStylesOnElement = (svgEl, originalText) => {
    const styleEls = Array.from(svgEl.querySelectorAll('style'));
    if (styleEls.length === 0) return originalText;

    const rules = [];
    for (const styleEl of styleEls) {
        const cssText = styleEl.textContent || '';
        const tmpStyle = document.createElement('style');
        tmpStyle.textContent = cssText;
        document.head.appendChild(tmpStyle);
        try {
            const sheet = tmpStyle.sheet;
            if (sheet) {
                for (let i = 0; i < sheet.cssRules.length; i++) {
                    const rule = sheet.cssRules[i];
                    if (rule instanceof CSSStyleRule) {
                        const props = new Map();
                        for (let j = 0; j < rule.style.length; j++) {
                            const prop = rule.style[j];
                            props.set(prop, rule.style.getPropertyValue(prop));
                        }
                        if (props.size > 0) {
                            rules.push({ selector: rule.selectorText, props });
                        }
                    }
                }
            }
        } finally {
            document.head.removeChild(tmpStyle);
        }
    }

    for (const { selector, props } of rules) {
        if (selector.startsWith('@') || selector === ':root') continue;
        let targets;
        try { targets = Array.from(svgEl.querySelectorAll(selector)); } catch { continue; }
        for (const el of targets) {
            const isSvgElement = el.namespaceURI === 'http://www.w3.org/2000/svg';
            const existingStyle = el.getAttribute('style') || '';
            const existingProps = new Set(
                existingStyle.split(';').map(s => s.split(':')[0].trim()).filter(Boolean)
            );
            const newStyleParts = existingStyle ? [existingStyle] : [];
            for (const [prop, val] of props) {
                if (existingProps.has(prop)) continue;
                if (isSvgElement && SVG_PRESENTATION_ATTRS[prop]) {
                    if (!el.hasAttribute(SVG_PRESENTATION_ATTRS[prop])) {
                        el.setAttribute(SVG_PRESENTATION_ATTRS[prop], val);
                    }
                } else {
                    newStyleParts.push(prop + ':' + val);
                }
            }
            const finalStyle = newStyleParts.join(';').replace(/;+/g, ';').replace(/^;|;$/g, '');
            if (finalStyle) el.setAttribute('style', finalStyle);
        }
    }

    for (const styleEl of styleEls) {
        const cssText = styleEl.textContent || '';
        const fontFaceRules = [];
        const fontFaceRegex = /@font-face\\s*\\{[^}]*url\\s*\\(\\s*data:[^)]+\\)[^}]*\\}/g;
        let match;
        while ((match = fontFaceRegex.exec(cssText)) !== null) {
            fontFaceRules.push(match[0]);
        }
        if (fontFaceRules.length > 0) {
            styleEl.textContent = fontFaceRules.join('\\n');
        } else {
            styleEl.remove();
        }
    }

    return new XMLSerializer().serializeToString(svgEl);
};

const inlineForeignObjectStyles = (svgText) => {
    if (!svgText.includes('<foreignObject')) return svgText;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);
    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;
        for (const fo of Array.from(svgEl.querySelectorAll('foreignObject'))) {
            for (const el of Array.from(fo.querySelectorAll('*'))) {
                const computed = window.getComputedStyle(el);
                const important = [
                    'color', 'background-color', 'font-family', 'font-size',
                    'font-weight', 'font-style', 'text-align', 'line-height',
                    'padding', 'margin', 'border', 'display', 'white-space',
                    'overflow', 'text-decoration', 'letter-spacing', 'word-spacing',
                ];
                const inlined = [];
                for (const prop of important) {
                    const val = computed.getPropertyValue(prop);
                    if (val) inlined.push(prop + ':' + val);
                }
                el.setAttribute('style', inlined.join(';'));
            }
        }
        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
};

const stripForeignObjects = (svgText) => {
    if (!svgText.includes('<foreignObject')) return svgText;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);
    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;
        for (const fo of Array.from(svgEl.querySelectorAll('foreignObject'))) {
            const text = (fo.textContent || '').trim();
            if (!text) { fo.remove(); continue; }
            let styledEl = fo;
            for (const el of Array.from(fo.querySelectorAll('span, p, div'))) {
                if ((el.textContent || '').trim().length > 0) styledEl = el;
            }
            const computed = window.getComputedStyle(styledEl);
            const foWidth = parseFloat(fo.getAttribute('width') || '0');
            const foHeight = parseFloat(fo.getAttribute('height') || '0');
            const foX = parseFloat(fo.getAttribute('x') || '0');
            const foY = parseFloat(fo.getAttribute('y') || '0');
            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('x', String(foX + foWidth / 2));
            textEl.setAttribute('y', String(foY + foHeight / 2));
            textEl.setAttribute('text-anchor', 'middle');
            textEl.setAttribute('dominant-baseline', 'central');
            textEl.setAttribute('font-family', computed.fontFamily || 'sans-serif');
            textEl.setAttribute('font-size', computed.fontSize || '14px');
            if (computed.fontWeight && computed.fontWeight !== '400' && computed.fontWeight !== 'normal') {
                textEl.setAttribute('font-weight', computed.fontWeight);
            }
            textEl.setAttribute('fill', computed.color || '#000');
            textEl.textContent = text;
            fo.parentNode?.replaceChild(textEl, fo);
        }
        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
};

const renderToCanvas = async (svgText, width, height, scale) => {
    // Ensure the SVG has explicit width/height attributes so the <img>
    // renders at the exact dimensions we want.
    let preparedSvg = svgText
        .replace(/(<svg[^>]*?)\\swidth=['"][^'"]*['"]/i, '$1')
        .replace(/(<svg[^>]*?)\\sheight=['"][^'"]*['"]/i, '$1')
        .replace(/(<svg)(\\s)/, '$1 width="' + width + '" height="' + height + '"$2');

    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(preparedSvg)));
    const img = await loadImage(dataUri);
    const drawW = width;
    const drawH = height;
    const canvas = document.createElement('canvas');
    canvas.width = drawW * scale;
    canvas.height = drawH * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, drawW, drawH);
    canvas.toDataURL(); // taint check
    return canvas;
};
`;
}

run().catch((err) => {
    console.error('[vrt] Fatal:', err.message);
    process.exit(2);
});
