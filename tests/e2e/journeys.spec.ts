import {
    chooseLanguage,
    editorSource,
    expect,
    expectTouchTarget,
    languageButton,
    openShareSheet,
    openTab,
    preview,
    rememberLocalRendering,
    renderedDiagram,
    replaceSource,
    settle,
    test,
} from './fixtures';
import { PREFERENCES_KEY } from '../../src/preferences/preferences';

const SESSION_ID = 'c'.repeat(64);
const origin = 'http://127.0.0.1:4174';

test.describe('first run', () => {
    test('asks before any remote render, then remembers the choice', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Keep diagrams where you expect' })).toBeVisible();
        await expect(editorSource(page)).toHaveCount(0);

        await page.getByRole('button', { name: 'Render locally only' }).click();
        await expect(languageButton(page)).toBeVisible();

        for (let reload = 0; reload < 2; reload += 1) {
            await page.reload();
            await expect(languageButton(page)).toBeVisible();
            await expect(page.getByRole('heading', { name: 'Keep diagrams where you expect' })).toHaveCount(0);
        }
    });
});

test.describe('editing', () => {
    test.beforeEach(async ({ page }) => {
        await rememberLocalRendering(page);
    });

    test('a snapshot link opens the same diagram through repeated reloads', async ({ page, context, layout }) => {
        await page.goto('/');
        await chooseLanguage(page, 'GraphViz');
        await expect.poll(() => new URL(page.url()).hash.length).toBeGreaterThan(1);
        const snapshot = page.url();

        // A fresh tab has no remembered section, as when someone opens a shared link.
        const shared = await context.newPage();
        await shared.goto(snapshot);
        for (let reload = 0; reload < 3; reload += 1) {
            if (reload > 0) await shared.reload();
            await expect(languageButton(shared)).toHaveAccessibleName('Diagram language: GraphViz');
            if (layout === 'compact') {
                await expect(shared.getByRole('heading', { level: 1, name: 'Preview' })).toBeAttached();
            }
            await expect(renderedDiagram(shared)).toBeVisible();
        }
    });

    test('the language sheet filters, switches and gives focus back', async ({ page, layout }) => {
        await page.goto('/');
        const invoker = languageButton(page);
        await invoker.click();
        const sheet = page.getByRole('dialog', { name: 'Diagram Language' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('radio', { name: 'PlantUML', exact: true })).toBeChecked();
        await expect(sheet.getByRole('region', { name: 'On This Device' })).toBeVisible();
        await expect(sheet.getByRole('region', { name: 'Needs a Render Server' })).toBeVisible();

        await sheet.getByRole('searchbox', { name: 'Search languages' }).fill('zzz');
        await expect(sheet.getByText('No languages match “zzz”.')).toBeVisible();

        // A search field with text takes the first Escape to clear itself, as on macOS.
        await page.keyboard.press('Escape');
        if (await sheet.isVisible()) await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        if (layout === 'wide') await expect(invoker).toBeFocused();

        await chooseLanguage(page, 'Mermaid');
        await expect(invoker).toHaveAccessibleName('Diagram language: Mermaid');
    });

    test('the share sheet names what each action needs', async ({ page, layout }) => {
        await page.goto('/');
        const { invoker, sheet } = await openShareSheet(page, layout);
        await expect(sheet.getByRole('button', { name: 'Copy Snapshot Link' })).toBeEnabled();
        await expect(sheet.getByRole('button', { name: 'New Session' })).toBeDisabled();
        await expect(sheet.getByText('Sessions unavailable in this deployment.')).toBeVisible();
        await expect(sheet.getByRole('button', { name: /^PDF/ })).toBeDisabled();
        await expect(sheet.getByRole('button', { name: 'SVG' })).toBeEnabled();

        // Focus goes into the sheet and comes back to the control that opened it.
        await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(invoker).toBeFocused();

        await invoker.click();
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(sheet).toBeHidden();
    });

    test('an SVG export downloads a file', async ({ page, layout, browserName }) => {
        test.skip(layout !== 'wide' && browserName === 'webkit', 'Touch layouts hand files to the system share sheet when it exists.');
        await page.goto('/');
        await chooseLanguage(page, 'GraphViz');
        await expect(renderedDiagram(page).first()).toBeAttached();
        const { sheet } = await openShareSheet(page, layout);
        const downloadPromise = page.waitForEvent('download');
        await sheet.getByRole('button', { name: 'SVG' }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('diagram.svg');
        await expect(page.getByRole('status').getByText('SVG exported')).toBeVisible();
    });

    test('examples open from the list for the current language', async ({ page, layout }) => {
        await page.goto('/');
        if (layout === 'wide') {
            await chooseLanguage(page, 'GraphViz');
            await page.getByRole('complementary', { name: 'Reference' }).getByRole('button').first().click();
            await expect(renderedDiagram(page)).toBeVisible();
            return;
        }
        await openTab(page, 'Examples');
        await expect(page.getByRole('heading', { level: 1, name: 'Examples' })).toBeVisible();
        const row = page.getByRole('region', { name: 'All Languages' }).getByRole('button', { name: /^GraphViz/ });
        await row.click();
        await expect(page.getByRole('heading', { level: 1, name: 'GraphViz' })).toBeFocused();

        await page.getByRole('button', { name: 'Examples', exact: true }).click();
        await expect(row).toBeFocused();

        await row.click();
        await page.getByRole('main').getByRole('button').filter({ hasNotText: 'Examples' }).nth(0).click();
        await expect(languageButton(page)).toHaveAccessibleName('Diagram language: GraphViz');
        if (layout === 'compact') await expect(page.getByRole('heading', { level: 1, name: 'Preview' })).toBeAttached();
        await expect(renderedDiagram(page)).toBeVisible();
    });

    test('search looks through every example', async ({ page, layout }) => {
        test.skip(layout === 'wide', 'The wide sidebar lists the current language only.');
        await page.goto('/');
        await openTab(page, 'Examples');
        const search = page.getByRole('searchbox', { name: 'Search examples' });
        await search.fill('sequence');
        await expect(page.getByRole('region', { name: 'PlantUML' })).toBeVisible();
        await search.fill('no such diagram');
        await expect(page.getByText('No Results for “no such diagram”')).toBeVisible();
    });

    test('zoom works with buttons and with a pinch', async ({ page, layout }) => {
        await page.goto('/');
        await chooseLanguage(page, 'GraphViz');
        if (layout === 'compact') await openTab(page, 'Preview');
        await expect(renderedDiagram(page)).toBeVisible();

        await page.getByRole('button', { name: 'Zoom in' }).click();
        await expect(preview(page)).toHaveAttribute('data-zoom', '1.25');
        await page.getByRole('button', { name: /^Reset zoom/ }).click();
        await expect(preview(page)).toHaveAttribute('data-zoom', '1');

        test.skip(layout === 'wide', 'Pinch applies to touch layouts.');
        // Playwright has no multi-touch API; send the two pointers directly.
        await preview(page).evaluate((element) => {
            const box = element.getBoundingClientRect();
            const y = box.top + box.height / 2;
            const x = box.left + box.width / 2;
            const fire = (type: string, pointerId: number, dx: number) => element.dispatchEvent(new PointerEvent(type, {
                bubbles: true, pointerId, pointerType: 'touch', clientX: x + dx, clientY: y, isPrimary: pointerId === 1,
            }));
            fire('pointerdown', 1, -40);
            fire('pointerdown', 2, 40);
            fire('pointermove', 1, -80);
            fire('pointermove', 2, 80);
            fire('pointerup', 1, -80);
            fire('pointerup', 2, 80);
        });
        await expect.poll(async () => Number(await preview(page).getAttribute('data-zoom'))).toBeGreaterThan(1.5);
        const image = await renderedDiagram(page).boundingBox();
        const canvas = await preview(page).evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
        expect(image!.width).toBeGreaterThan(0);
        // A zoomed diagram is panned, not clipped: the canvas scrolls.
        expect(canvas.scrollWidth).toBeGreaterThanOrEqual(canvas.clientWidth);
    });

    test('printing shows only the diagram, fitted to one page', async ({ page, layout, browserName }, testInfo) => {
        await page.goto('/');
        // Let the first render finish: a reload mid-download aborts the renderer's WebAssembly.
        await expect(page.locator('.PrintDiagram img')).toHaveAttribute('src', /^blob:/);
        // Dark appearance on screen must still print on white.
        await page.evaluate((key) => {
            const preferences = JSON.parse(window.localStorage.getItem(key) || '{}');
            window.localStorage.setItem(key, JSON.stringify({ ...preferences, appearance: 'dark' }));
        }, PREFERENCES_KEY);
        await page.reload();
        await expect(page.locator('.App')).toHaveAttribute('data-appearance', 'dark');
        await chooseLanguage(page, 'GraphViz');
        // Print from the source tab: the printed copy does not depend on the open tab.
        if (layout === 'compact') await openTab(page, 'Code');
        const printed = page.locator('.PrintDiagram img');
        await expect(printed).toHaveAttribute('src', /^blob:/);

        await page.emulateMedia({ media: 'print' });
        await expect(printed).toBeVisible();
        await expect(editorSource(page)).toBeHidden();
        await expect(page.locator('.PreviewPanel')).toBeHidden();
        for (const chrome of await page.locator('.App > :not(.PrintDiagram)').all()) await expect(chrome).toBeHidden();
        const background = await page.locator('.App').evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(background, 'prints on white even in dark appearance').toBe('rgb(255, 255, 255)');
        const box = await printed.boundingBox();
        const viewport = page.viewportSize()!;
        expect(box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.height).toBeLessThanOrEqual(viewport.height);

        if (browserName === 'chromium') {
            const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
            await testInfo.attach('print.pdf', { body: pdf, contentType: 'application/pdf' });
            const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || [];
            expect(pages, 'the diagram prints on a single page').toHaveLength(1);
        }
    });

    test('Print in the share sheet opens the print dialog', async ({ page, layout }) => {
        await page.addInitScript(() => {
            (window as unknown as { printed: number }).printed = 0;
            window.print = () => { (window as unknown as { printed: number }).printed += 1; };
        });
        await page.goto('/');
        await chooseLanguage(page, 'GraphViz');
        await expect(page.locator('.PrintDiagram img')).toHaveAttribute('src', /^blob:/);
        const { sheet } = await openShareSheet(page, layout);
        await sheet.getByRole('button', { name: 'Print…' }).click();
        await expect(sheet).toBeHidden();
        await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
    });

    test('settings change the appearance and keep it through a reload', async ({ page, layout }) => {
        await page.goto('/');
        if (layout !== 'wide') await openTab(page, 'Settings');
        await page.getByText('Dark', { exact: true }).click();
        await expect(page.locator('.App')).toHaveAttribute('data-appearance', 'dark');
        await page.reload();
        await expect(page.locator('.App')).toHaveAttribute('data-appearance', 'dark');
        if (layout !== 'wide') await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    });
});

test.describe('imperfect states', () => {
    test.beforeEach(async ({ page }) => {
        await rememberLocalRendering(page);
    });

    test('empty source shows an empty state, not a blank canvas', async ({ page, layout }) => {
        await page.goto('/');
        await chooseLanguage(page, 'GraphViz');
        if (layout === 'compact') await openTab(page, 'Code');
        await replaceSource(page, '');
        if (layout === 'compact') await openTab(page, 'Preview');
        await expect(preview(page).getByText('No Diagram Yet')).toBeVisible();
    });

    test('a source error keeps the shell and explains the failure', async ({ page, layout }) => {
        await page.goto('/');
        await chooseLanguage(page, 'GraphViz');
        if (layout === 'compact') await openTab(page, 'Code');
        await replaceSource(page, 'digraph { a -> ');
        if (layout === 'compact') await openTab(page, 'Preview');
        await expect(preview(page).getByRole('alert')).toContainText('Can’t Render This Diagram');
        await expect(languageButton(page)).toBeVisible();
    });

    test('a language that needs a server says so and offers the choice', async ({ page, layout }) => {
        await page.goto('/');
        await chooseLanguage(page, 'TikZ');
        if (layout === 'compact') await openTab(page, 'Preview');
        const alert = preview(page).getByRole('alert');
        await expect(alert).toContainText('Remote Rendering Is Off');
        await expect(alert.getByRole('button', { name: /^Allow Rendering at / })).toBeVisible();
    });

    test.describe('without a runtime config', () => {
        test.use({ allowedConsoleErrors: { allow: [/Failed to load resource/] } });

        test('the editor still opens when config.json cannot be fetched', async ({ page }) => {
            await page.route('**/config.json', (route) => route.abort());
            await page.goto('/');
            await expect(languageButton(page)).toBeVisible();
        });
    });

    test.describe('with a broken runtime config', () => {
        test.use({ allowedConsoleErrors: { allow: [/ignoring runtime config/] } });

        test('the editor opens on the built-in render server', async ({ page }) => {
            await page.route('**/config.json', (route) => route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ renderServerUrl: 42 }),
            }));
            await page.goto('/');
            await expect(languageButton(page)).toBeVisible();
        });
    });

    test.describe('with an expired session link', () => {
        test.use({ allowedConsoleErrors: { allow: [/Failed to load resource/, /404/] } });

        test('the session link falls back to an editable local snapshot', async ({ page }) => {
            await page.route('**/config.json', (route) => route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ renderServerUrl: `${origin}/render/`, sessionBackendUrl: origin }),
            }));
            await page.route('**/api/sessions/**', (route) => route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Session not found' }),
            }));
            await page.goto(`/s/${SESSION_ID}`);
            await expect(page.getByRole('status').getByText('Session expired. Continuing as a local snapshot.')).toBeVisible();
            await expect.poll(() => new URL(page.url()).pathname).toBe('/');
            await expect(page.getByRole('button', { name: /^Live session/ })).toHaveCount(0);
            // The notice stays until dismissed: it explains a change the person did not make.
            await page.getByRole('button', { name: 'Dismiss' }).click();
            await expect(page.getByText('Session expired. Continuing as a local snapshot.')).toHaveCount(0);
        });
    });
});

test.describe('phone ergonomics', () => {
    test.beforeEach(async ({ page, layout }) => {
        test.skip(layout === 'wide', 'Touch layouts only.');
        await rememberLocalRendering(page);
    });

    test('controls meet the 44 pt touch target', async ({ page, layout }) => {
        await page.goto('/');
        for (const tab of await page.getByRole('tab').all()) {
            await expectTouchTarget(tab, `tab ${await tab.textContent()}`);
        }
        await expectTouchTarget(page.getByRole('button', { name: 'Share and export' }), 'Share');
        await expectTouchTarget(languageButton(page), 'language title');
        if (layout === 'compact') await openTab(page, 'Preview');
        await expectTouchTarget(page.getByRole('button', { name: 'Zoom in' }), 'Zoom in');
        await expectTouchTarget(page.getByRole('button', { name: 'Zoom out' }), 'Zoom out');

        const { sheet } = await openShareSheet(page, layout);
        await expectTouchTarget(sheet.getByRole('button', { name: 'Done' }), 'Done');
        await expectTouchTarget(sheet.getByRole('button', { name: 'Copy Snapshot Link' }), 'sheet row');
        await sheet.getByRole('button', { name: 'Done' }).click();

        await openTab(page, 'Settings');
        await expectTouchTarget(page.getByText('Wrap Long Lines').locator('xpath=ancestor::label'), 'switch row');
        await expectTouchTarget(page.getByText('On This Device Only').locator('xpath=ancestor::label'), 'option row');
    });

    test('the layout respects the safe area and never scrolls sideways', async ({ page, layout }) => {
        await page.goto('/');
        for (const tab of layout === 'compact' ? ['Code', 'Preview', 'Examples', 'Settings'] : ['Editor', 'Examples', 'Settings']) {
            await openTab(page, tab);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow, `${tab} has no horizontal page scroll`).toBeLessThanOrEqual(0);
        }
        const viewport = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content'));
        expect(viewport).toContain('viewport-fit=cover');
        expect(viewport).not.toContain('maximum-scale');
    });

    test('Reduce Motion removes sheet movement', async ({ page, layout }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        const { sheet } = await openShareSheet(page, layout);
        const duration = await sheet.evaluate((element) => getComputedStyle(element).animationDuration);
        expect(parseFloat(duration)).toBeLessThan(0.01);
        await settle(page);
    });
});
