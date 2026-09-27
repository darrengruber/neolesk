import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import catalog from '../../src/examples/catalog';
import type { LayoutClass } from '../../src/ui/model';
import { expect, openShareSheet, preview, rememberLocalRendering, renderedDiagram, test } from './fixtures';

/**
 * Every example of a language this device renders, exported as PNG with no
 * render server (ADR 0021). Each exception is named with its reason, so a
 * change in either direction fails the test.
 *
 * One test per language, so the workers share the corpus, and one page per
 * language, so each renderer (22 MB of D2, 10 MB of PlantUML) loads once. The
 * desktop covers every example; the iPhone covers the first of each language,
 * which is enough to prove the WebKit canvas and download path.
 */
const BROWSER_LANGUAGES = [
    'bpmn', 'bytefield', 'c4plantuml', 'd2', 'dbml', 'graphviz', 'mermaid',
    'nomnoml', 'pikchr', 'plantuml', 'svgbob', 'vega', 'vegalite', 'wavedrom',
];

// The only examples that do not export PNG on this device, and why.
const EXCEPTIONS: Record<string, string> = {
    'd2: Twitter': 'needs-server',
    'd2: Markdown': 'needs-server',
    'mermaid: User Journey diagram': 'needs-server',
    // Salt draws only on the server (the MIT PlantUML build cannot).
    'plantuml: Salt mockup': 'no-local-render',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].join();
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** Show an example and wait for its own render, not the one it replaces. */
const showExample = async (page: Page, hash: string, first: boolean) => {
    const drawn = renderedDiagram(page).first();
    const failed = preview(page).getByRole('alert').first();
    // Read without waiting: after a failed render there is no image to wait for.
    const currentSrc = async () => (await drawn.count() ? drawn.getAttribute('src') : null);
    const before = first ? null : await currentSrc();
    if (first) {
        await page.goto(`/${hash}`);
    } else {
        await page.evaluate((next) => { window.location.hash = next; }, hash);
    }
    await expect.poll(async () => {
        if (await failed.isVisible()) return 'failed';
        const src = await currentSrc();
        return src && src !== before ? 'drawn' : 'waiting';
    }, { timeout: 60_000 }).not.toBe('waiting');
    return await failed.isVisible() ? 'failed' : 'drawn';
};

const exportOutcome = async (page: Page, layout: LayoutClass): Promise<string> => {
    const { sheet } = await openShareSheet(page, layout);
    // The sheet asks the exporter, which can draw Mermaid again, before it answers.
    const footer = sheet.getByText(/Every format is made on this device|need a render server for this diagram/);
    await expect(footer).toBeVisible();
    const png = sheet.getByRole('button', { name: /^PNG/ });
    if (!/Every format/.test((await footer.textContent()) ?? '')) {
        await expect(png).toBeDisabled();
        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(sheet).toBeHidden();
        return 'needs-server';
    }
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await png.click();
    const status = page.getByRole('status');
    // Either the file arrives, or the status line says why it did not.
    await expect(status.getByText(/^PNG export/)).toBeVisible({ timeout: 60_000 });
    const message = (await status.textContent()) ?? '';
    const download = await downloadPromise;
    if (!message.includes('PNG exported on this device') || !download) return `failed: ${message}`;
    const file = readFileSync((await download.path())!);
    const size = pngSize(file);
    // A degenerate drawing (say, a 1px-wide Gantt chart) is not an export.
    const valid = [...file.subarray(0, 8)].join() === PNG_SIGNATURE && size.width >= 40 && size.height >= 20;
    return valid ? 'local' : `bad PNG ${size.width}x${size.height}`;
};

test.describe('export corpus', () => {
    test.beforeEach(async ({ page, layout }) => {
        test.skip(layout === 'regular', 'The iPhone and the desktop cover both engines.');
        await rememberLocalRendering(page);
        // A download, not the system share sheet, so the test can read the file.
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
        });
    });

    for (const language of BROWSER_LANGUAGES) {
        test(`every ${language} example exports PNG on this device, or is a named exception`, async ({ page, layout }) => {
            test.setTimeout(5 * 60_000);
            const all = catalog.filter((example) => example.diagramType === language);
            const examples = layout === 'compact' ? all.slice(0, 1) : all;
            expect(examples.length).toBeGreaterThan(0);
            const outcomes: Record<string, string> = {};
            const seen = new Map<string, number>();
            for (const [index, example] of examples.entries()) {
                const base = `${language}: ${example.description}`;
                const count = (seen.get(base) ?? 0) + 1;
                seen.set(base, count);
                // Some languages have two examples with one description.
                const name = count === 1 ? base : `${base} (${count})`;
                const shown = await showExample(page, `#${language}/svg/${example.example}`, index === 0);
                outcomes[name] = shown === 'failed' ? 'no-local-render' : await exportOutcome(page, layout);
            }
            const expected = Object.fromEntries(Object.keys(outcomes).map((name) => [name, EXCEPTIONS[name] ?? 'local']));
            expect(outcomes).toEqual(expected);
        });
    }
});
