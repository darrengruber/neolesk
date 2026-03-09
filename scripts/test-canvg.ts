import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import examples from '../src/examples';
import { getExampleCacheFilename } from '../src/examples/cacheKey';

async function main() {
    // Test all diagram types, not just mermaid/d2
    const testExamples: { diagramType: string; name: string; svgText: string }[] = [];
    for (const ex of examples) {
        const file = getExampleCacheFilename(ex);
        const svg = readFileSync(`public/cache/${file}`, 'utf-8');
        testExamples.push({
            diagramType: ex.diagramType,
            name: ex.title || ex.description || '',
            svgText: svg,
        });
    }

    // Build test page with the three-tier logic inlined
    const testPageHtml = `<!DOCTYPE html><html><body>
<script type="module">
const examples = ${JSON.stringify(testExamples.map(e => ({ d: e.diagramType, n: e.name, s: e.svgText })))};

function createBlobUrl(svg) {
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

function loadImg(src) {
    return new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('load failed'));
        i.src = src;
    });
}

async function nativeCanvas(svg, w, h) {
    const url = createBlobUrl(svg);
    try {
        const img = await loadImg(url);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        c.toDataURL(); // taint check
        return true;
    } catch { return false; }
    finally { URL.revokeObjectURL(url); }
}

async function canvgCanvas(svg, w, h) {
    try {
        const { Canvg } = await import('https://esm.sh/canvg@4.0.3');
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h);
        const v = Canvg.fromString(ctx, svg, { ignoreDimensions: true, scaleWidth: w, scaleHeight: h, ignoreClear: true });
        await v.render();
        return true;
    } catch { return false; }
}

function stripFO(svg) {
    if (svg.indexOf('<foreignObject') === -1) return svg;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;visibility:hidden';
    container.innerHTML = svg;
    document.body.appendChild(container);
    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svg;
        for (const fo of svgEl.querySelectorAll('foreignObject')) {
            const text = (fo.textContent || '').trim();
            if (!text) { fo.remove(); continue; }
            let styledEl = fo;
            for (const el of fo.querySelectorAll('span, p, div')) {
                if ((el.textContent||'').trim().length > 0) styledEl = el;
            }
            const cs = getComputedStyle(styledEl);
            const fw = parseFloat(fo.getAttribute('width')||fo.style.getPropertyValue('width')||'0');
            const fh = parseFloat(fo.getAttribute('height')||fo.style.getPropertyValue('height')||'0');
            const fx = parseFloat(fo.getAttribute('x')||'0');
            const fy = parseFloat(fo.getAttribute('y')||'0');
            const t = document.createElementNS('http://www.w3.org/2000/svg','text');
            t.setAttribute('x', String(fx + fw/2));
            t.setAttribute('y', String(fy + fh/2));
            t.setAttribute('text-anchor','middle');
            t.setAttribute('dominant-baseline','central');
            t.setAttribute('font-family', cs.fontFamily||'sans-serif');
            t.setAttribute('font-size', cs.fontSize||'16px');
            t.setAttribute('fill', cs.color||'#000');
            t.textContent = text;
            fo.parentNode.replaceChild(t, fo);
        }
        return new XMLSerializer().serializeToString(svgEl);
    } finally { document.body.removeChild(container); }
}

const results = [];
for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    const hasFO = ex.s.includes('<foreignObject');
    const hasFF = ex.s.includes('@font-face');
    const t1 = await nativeCanvas(ex.s, 800, 600);
    let t2 = false, t3 = false;
    if (!t1) {
        t2 = await canvgCanvas(ex.s, 800, 600);
        if (!t2) {
            const stripped = stripFO(ex.s);
            t3 = await nativeCanvas(stripped, 800, 600);
        }
    }
    const winner = t1 ? 'native' : t2 ? 'canvg' : t3 ? 'strip+native' : 'NONE';
    results.push({ d: ex.d, n: ex.n, hasFO, hasFF, winner });
}
window.__results = results;
</script></body></html>`;

    writeFileSync('/tmp/test-tiers.html', testPageHtml);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => { if (msg.type() === 'error') console.error('  Browser:', msg.text()); });

    await page.goto('file:///tmp/test-tiers.html');
    await page.waitForFunction(() => (window as any).__results, { timeout: 120000 });

    const results: any[] = await page.evaluate(() => (window as any).__results);

    console.log('Type'.padEnd(15) + 'Name'.padEnd(22) + 'FO  FF  Winner');
    console.log('-'.repeat(60));
    for (const r of results) {
        console.log(
            r.d.padEnd(15) +
            r.n.slice(0, 20).padEnd(22) +
            (r.hasFO ? 'Y   ' : 'N   ') +
            (r.hasFF ? 'Y   ' : 'N   ') +
            r.winner
        );
    }

    // Summary
    const byWinner: Record<string, number> = {};
    for (const r of results) byWinner[r.winner] = (byWinner[r.winner] || 0) + 1;
    console.log('\n=== Summary ===');
    for (const [w, c] of Object.entries(byWinner)) console.log(`  ${w}: ${c}`);

    const failures = results.filter(r => r.winner === 'NONE');
    if (failures.length > 0) {
        console.log('\n=== FAILURES ===');
        for (const f of failures) console.log(`  ${f.d}: ${f.n}`);
    }

    await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
