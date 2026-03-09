/**
 * Audit cached SVG examples for svg2pdf.js compatibility.
 *
 * Actually renders each SVG through svg2pdf.js in a jsdom environment
 * and checks whether text content survived in the PDF output.
 *
 * Usage: npx tsx scripts/audit-svg-pdf.ts
 */

import { JSDOM } from 'jsdom';

// Set up DOM globals that jsPDF and svg2pdf.js need
const dom = new JSDOM('<!DOCTYPE html>');
(global as any).document = dom.window.document;
(global as any).window = dom.window;
(global as any).DOMParser = dom.window.DOMParser;
(global as any).XMLSerializer = dom.window.XMLSerializer;
(global as any).navigator = dom.window.navigator;
(global as any).HTMLElement = dom.window.HTMLElement;
(global as any).Element = dom.window.Element;
(global as any).SVGElement = dom.window.SVGElement;
(global as any).getComputedStyle = dom.window.getComputedStyle;

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import examples from '../src/examples';
import { getExampleCacheFilename } from '../src/examples/cacheKey';

const cacheDir = 'public/cache';

function countSvgTextElements(svgText: string): number {
    return (svgText.match(/<text[\s>]/g) || []).length;
}

function countPdfTextOps(pdfRaw: string): number {
    // PDF text operators: (text) Tj  or  [(array)] TJ
    const tj = (pdfRaw.match(/\)\s*Tj/g) || []).length;
    const tJ = (pdfRaw.match(/\]\s*TJ/g) || []).length;
    return tj + tJ;
}

function detectSvgIssues(svgText: string): string[] {
    const issues: string[] = [];
    if (svgText.includes('<foreignObject')) issues.push('foreignObject');
    if (/@font-face\s*\{/.test(svgText)) issues.push('font-face');
    if (svgText.includes('data:image/png') || svgText.includes('data:image/jpeg')) issues.push('embedded-raster');
    if (/<style[\s>]/.test(svgText)) issues.push('has-css-style');
    if (svgText.includes('<switch')) issues.push('switch-element');
    return issues;
}

interface TestResult {
    name: string;
    diagramType: string;
    file: string;
    svgTextElements: number;
    pdfTextOps: number;
    error: string | null;
    svgIssues: string[];
    verdict: 'PASS' | 'FAIL' | 'ERROR' | 'NO_TEXT';
}

async function testSvg(svgText: string, info: { diagramType: string; name: string; file: string }): Promise<TestResult> {
    const svgTextElements = countSvgTextElements(svgText);
    const svgIssues = detectSvgIssues(svgText);

    if (svgTextElements === 0) {
        return {
            ...info,
            svgTextElements,
            pdfTextOps: 0,
            error: null,
            svgIssues,
            verdict: 'NO_TEXT',
        };
    }

    try {
        const pdf = new jsPDF({ unit: 'px', format: [800, 600] });
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');

        if (!svgEl) throw new Error('No <svg> element found');

        await svg2pdf(svgEl, pdf, { x: 0, y: 0, width: 800, height: 600 });
        const raw = pdf.output();
        const pdfTextOps = countPdfTextOps(raw);

        return {
            ...info,
            svgTextElements,
            pdfTextOps,
            error: null,
            svgIssues,
            verdict: pdfTextOps > 0 ? 'PASS' : 'FAIL',
        };
    } catch (e: any) {
        return {
            ...info,
            svgTextElements,
            pdfTextOps: 0,
            error: e.message || String(e),
            svgIssues,
            verdict: 'ERROR',
        };
    }
}

async function main() {
    // Build map: filename -> example info
    const filenameMap = new Map<string, { diagramType: string; name: string }>();
    for (const ex of examples) {
        const filename = getExampleCacheFilename(ex);
        filenameMap.set(filename, {
            diagramType: ex.diagramType,
            name: ex.title || ex.description || ex.diagramType,
        });
    }

    const files = readdirSync(cacheDir).filter(f => f.endsWith('.svg'));
    const results: TestResult[] = [];

    for (const file of files) {
        const svgText = readFileSync(join(cacheDir, file), 'utf-8');
        const info = filenameMap.get(file) || { diagramType: `unknown`, name: file };
        const result = await testSvg(svgText, { ...info, file });
        results.push(result);

        const icon = result.verdict === 'PASS' ? '✓' : result.verdict === 'NO_TEXT' ? '-' : result.verdict === 'FAIL' ? '✗' : '!';
        process.stdout.write(`${icon}`);
    }

    console.log('\n');

    // Group by diagram type
    const byType = new Map<string, TestResult[]>();
    for (const r of results) {
        if (!byType.has(r.diagramType)) byType.set(r.diagramType, []);
        byType.get(r.diagramType)!.push(r);
    }

    // Summary table
    console.log('=== svg2pdf.js Compatibility Test Results ===\n');
    console.log(
        'Diagram Type'.padEnd(18) +
        'Ex#'.padEnd(5) +
        'Pass'.padEnd(6) +
        'Fail'.padEnd(6) +
        'Err'.padEnd(6) +
        'NoTxt'.padEnd(7) +
        'Issues'.padEnd(40) +
        'Verdict'
    );
    console.log('-'.repeat(120));

    const typeVerdicts: Record<string, string[]> = { vector: [], raster: [] };

    for (const [type, exs] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const pass = exs.filter(e => e.verdict === 'PASS').length;
        const fail = exs.filter(e => e.verdict === 'FAIL').length;
        const err = exs.filter(e => e.verdict === 'ERROR').length;
        const noText = exs.filter(e => e.verdict === 'NO_TEXT').length;

        const allIssues = new Set<string>();
        for (const ex of exs) ex.svgIssues.forEach(i => allIssues.add(i));
        const issueStr = allIssues.size > 0 ? [...allIssues].join(', ') : '';

        const needsRaster = fail > 0 || err > 0;
        const verdict = needsRaster ? 'RASTER' : 'vector';

        if (needsRaster) typeVerdicts.raster.push(type);
        else typeVerdicts.vector.push(type);

        console.log(
            type.padEnd(18) +
            String(exs.length).padEnd(5) +
            String(pass).padEnd(6) +
            String(fail).padEnd(6) +
            String(err).padEnd(6) +
            String(noText).padEnd(7) +
            issueStr.padEnd(40) +
            verdict
        );

        // Show detail for failures/errors
        for (const ex of exs) {
            if (ex.verdict === 'FAIL') {
                console.log(`  ✗ ${ex.name}: ${ex.svgTextElements} <text> elements → 0 PDF text ops`);
            } else if (ex.verdict === 'ERROR') {
                console.log(`  ! ${ex.name}: ${ex.error}`);
            }
        }
    }

    console.log('\n=== Summary ===\n');
    console.log(`Vector OK (${typeVerdicts.vector.length}): ${typeVerdicts.vector.join(', ')}`);
    console.log(`Needs raster (${typeVerdicts.raster.length}): ${typeVerdicts.raster.join(', ')}`);

    console.log('\n=== Code snippet for svgExport.ts ===\n');
    console.log('// Diagram types that need raster PDF export (svg2pdf.js drops text or errors).');
    console.log('// Generated by: npx tsx scripts/audit-svg-pdf.ts');
    console.log(`const rasterPdfDiagramTypes = new Set(${JSON.stringify(typeVerdicts.raster)});`);
}

main().catch(console.error);
