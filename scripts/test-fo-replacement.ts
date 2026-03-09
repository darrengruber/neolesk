import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import examples from '../src/examples';
import { getExampleCacheFilename } from '../src/examples/cacheKey';

async function main() {
    const foExamples: { diagramType: string; name: string; svgText: string }[] = [];
    for (const ex of examples) {
        const file = getExampleCacheFilename(ex);
        const svg = readFileSync(`public/cache/${file}`, 'utf-8');
        if (svg.indexOf('<foreignObject') !== -1) {
            foExamples.push({
                diagramType: ex.diagramType,
                name: ex.title || ex.description || '',
                svgText: svg,
            });
        }
    }

    console.log(`Testing ${foExamples.length} SVGs with <foreignObject>\n`);

    // Build inline test page with the actual replaceForeignObjects from svgExport.ts
    const replaceFnSource = readFileSync('src/utils/svgExport.ts', 'utf-8');

    // Extract just the replaceForeignObjects function body for inline use
    const testPage = `<!DOCTYPE html><html><body>
<script type="module">
const examples = ${JSON.stringify(foExamples.map(e => ({ diagramType: e.diagramType, name: e.name, svgText: e.svgText })))};

// Inline the actual replaceForeignObjects function
function replaceForeignObjects(svgText) {
    if (svgText.indexOf('<foreignObject') === -1) return svgText;

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none';
    container.innerHTML = svgText;
    document.body.appendChild(container);

    try {
        const svgEl = container.querySelector('svg');
        if (!svgEl) return svgText;

        const foreignObjects = svgEl.querySelectorAll('foreignObject');

        for (const fo of foreignObjects) {
            const text = (fo.textContent || '').trim();
            if (!text) { fo.remove(); continue; }

            const candidates = fo.querySelectorAll('span, p, div');
            let styledEl = fo;
            for (const el of candidates) {
                if ((el.textContent || '').trim().length > 0) styledEl = el;
            }

            const computed = window.getComputedStyle(styledEl);
            const fontFamily = computed.fontFamily || 'sans-serif';
            const fontSize = computed.fontSize || '16px';
            const fontWeight = computed.fontWeight || '400';
            const fontStyle = computed.fontStyle || 'normal';
            const color = computed.color || 'rgb(0,0,0)';
            const textAlign = computed.textAlign || 'center';

            const foWidth = parseFloat(fo.getAttribute('width') || fo.style.getPropertyValue('width') || '0');
            const foHeight = parseFloat(fo.getAttribute('height') || fo.style.getPropertyValue('height') || '0');
            const foX = parseFloat(fo.getAttribute('x') || '0');
            const foY = parseFloat(fo.getAttribute('y') || '0');

            const anchorMap = { start: 'start', left: 'start', end: 'end', right: 'end' };
            const textAnchor = anchorMap[textAlign] || 'middle';
            let x;
            if (textAnchor === 'start') x = foX + 2;
            else if (textAnchor === 'end') x = foX + foWidth - 2;
            else x = foX + foWidth / 2;

            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('x', String(x));
            textEl.setAttribute('y', String(foY + foHeight / 2));
            textEl.setAttribute('text-anchor', textAnchor);
            textEl.setAttribute('dominant-baseline', 'central');
            textEl.setAttribute('font-family', fontFamily);
            textEl.setAttribute('font-size', fontSize);
            if (fontWeight !== '400' && fontWeight !== 'normal') textEl.setAttribute('font-weight', fontWeight);
            if (fontStyle !== 'normal') textEl.setAttribute('font-style', fontStyle);
            textEl.setAttribute('fill', color);
            textEl.textContent = text;
            fo.parentNode.replaceChild(textEl, fo);
        }

        return new XMLSerializer().serializeToString(svgEl);
    } finally {
        document.body.removeChild(container);
    }
}

async function testCanvas(safeSvg) {
    const blob = new Blob([safeSvg], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('load failed'));
        i.src = blobUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    canvas.toDataURL('image/png');
    URL.revokeObjectURL(blobUrl);
}

async function testSvg2Pdf(safeSvg) {
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([
        import('https://esm.sh/jspdf@4.2.0'),
        import('https://esm.sh/svg2pdf.js@2.7.0'),
    ]);
    const pdf = new jsPDF({ unit: 'px', format: [800, 600] });
    const parser = new DOMParser();
    const doc = parser.parseFromString(safeSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    await svg2pdf(svgEl, pdf, { x: 0, y: 0, width: 800, height: 600 });
    const raw = pdf.output();
    return (raw.match(/\\)\\s*Tj/g) || []).length + (raw.match(/\\]\\s*TJ/g) || []).length;
}

const results = [];
for (const ex of examples) {
    const safeSvg = replaceForeignObjects(ex.svgText);
    const hasFO = safeSvg.includes('<foreignObject');
    const textCount = (safeSvg.match(/<text[\\s>]/g) || []).length;

    // Check that font attrs are on the text elements
    const fontAttrs = (safeSvg.match(/font-family="[^"]+"/g) || []).slice(0, 3);

    let canvasOk = false, svg2pdfOk = false, pdfTextOps = 0;
    try { await testCanvas(safeSvg); canvasOk = true; } catch {}
    try { pdfTextOps = await testSvg2Pdf(safeSvg); svg2pdfOk = true; } catch {}
    results.push({ type: ex.diagramType, name: ex.name, hasFO, textCount, canvasOk, svg2pdfOk, pdfTextOps, fontAttrs });
}
window.__results = results;
</script></body></html>`;

    writeFileSync('/tmp/test-fo.html', testPage);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', msg => { if (msg.type() === 'error') console.error('Browser:', msg.text()); });

    await page.goto('file:///tmp/test-fo.html');
    await page.waitForFunction(() => (window as any).__results, { timeout: 60000 });

    const results: any[] = await page.evaluate(() => (window as any).__results);

    console.log(
        'Type'.padEnd(15) +
        'Name'.padEnd(20) +
        'Texts'.padEnd(7) +
        'FO?'.padEnd(5) +
        'Canvas'.padEnd(9) +
        'svg2pdf'.padEnd(9) +
        'PdfOps'.padEnd(8) +
        'Fonts'
    );
    console.log('-'.repeat(110));
    for (const r of results) {
        console.log(
            r.type.padEnd(15) +
            r.name.slice(0, 18).padEnd(20) +
            String(r.textCount).padEnd(7) +
            (r.hasFO ? 'YES' : 'no').padEnd(5) +
            (r.canvasOk ? 'OK' : 'TAINT').padEnd(9) +
            (r.svg2pdfOk ? 'OK' : 'FAIL').padEnd(9) +
            String(r.pdfTextOps).padEnd(8) +
            (r.fontAttrs || []).join(' | ').slice(0, 60)
        );
    }

    await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
