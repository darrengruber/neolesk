/**
 * Run the svg2pdf.js browser audit using Playwright.
 * Requires dev server running on port 5173.
 *
 * Usage: npx playwright test scripts/run-audit-browser.ts
 * Or:    npx tsx scripts/run-audit-browser.ts
 */
import { chromium } from 'playwright';

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Collect console output
    page.on('console', msg => {
        if (msg.type() === 'error') console.error('Browser:', msg.text());
    });

    console.log('Opening audit page...');
    await page.goto('http://localhost:5173/audit-svg-pdf.html', { waitUntil: 'domcontentloaded' });

    // Wait for the test to complete (progress says "Done!")
    console.log('Running tests in browser...');
    await page.waitForFunction(
        () => document.getElementById('progress')?.textContent?.startsWith('Done!'),
        { timeout: 120_000 },
    );

    // Extract the summary
    const summary = await page.$eval('#summary', el => el.textContent);
    console.log('\n' + summary);

    // Extract full results table
    const rows = await page.$$eval('#results tbody tr', trs =>
        trs.map(tr => {
            const cells = tr.querySelectorAll('td');
            return {
                diagramType: cells[0]?.textContent || '',
                name: cells[2]?.textContent || '',
                textCount: cells[3]?.textContent || '',
                pdfTextOps: cells[4]?.textContent || '',
                verdict: cells[5]?.textContent || '',
                error: cells[6]?.textContent || '',
            };
        })
    );

    // Print detailed table
    console.log('\n=== Detailed Results ===\n');
    console.log(
        'Type'.padEnd(18) +
        'Name'.padEnd(30) +
        '<text>'.padEnd(8) +
        'PdfOps'.padEnd(8) +
        'Verdict'.padEnd(10) +
        'Error'
    );
    console.log('-'.repeat(100));

    for (const r of rows) {
        console.log(
            r.diagramType.padEnd(18) +
            r.name.slice(0, 28).padEnd(30) +
            r.textCount.padEnd(8) +
            r.pdfTextOps.padEnd(8) +
            r.verdict.padEnd(10) +
            r.error
        );
    }

    await browser.close();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
