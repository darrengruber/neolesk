import type { Page } from '@playwright/test';
import {
    axeViolations,
    chooseLanguage,
    expect,
    openShareSheet,
    openTab,
    rememberLocalRendering,
    renderedDiagram,
    saveScreenshot,
    settle,
    test,
    type Appearance,
} from './fixtures';

/**
 * Axe on every screen and sheet in light and dark, plus a screenshot of each
 * for a person to look at. Axe is a gate; it does not prove the hierarchy.
 */
for (const appearance of ['light', 'dark'] as Appearance[]) {
    test.describe(`${appearance} appearance`, () => {
        test.use({ colorScheme: appearance === 'dark' ? 'dark' : 'light' });

        test.beforeEach(async ({ page }) => {
            await rememberLocalRendering(page, appearance);
        });

        test('every screen and sheet passes axe', async ({ page, layout }, testInfo) => {
            const name = (screen: string) => `${testInfo.project.name}-${appearance}-${screen}`;
            const check = async (screen: string) => {
                await settle(page);
                expect(await axeViolations(page), `${screen} has no axe violations`).toEqual([]);
                await saveScreenshot(page, name(screen));
            };
            const visit = async (tab: string, screen: string, page_: Page = page) => {
                if (layout !== 'wide') await openTab(page_, tab);
                await check(screen);
            };

            await page.goto('/');
            await chooseLanguage(page, 'GraphViz');
            await expect(renderedDiagram(page)).toBeVisible({ timeout: 30_000 }).catch(() => undefined);

            if (layout === 'wide') {
                await check('workspace');
            } else {
                await visit(layout === 'compact' ? 'Code' : 'Editor', 'code');
                if (layout === 'compact') await visit('Preview', 'preview');
                await visit('Examples', 'examples');
                await page.getByRole('region', { name: 'Current Language' }).getByRole('button').first().click();
                await check('examples-language');
                await visit('Settings', 'settings');
                await openTab(page, layout === 'compact' ? 'Preview' : 'Editor');
            }

            const { sheet } = await openShareSheet(page, layout);
            await check('share-sheet');
            await sheet.getByRole('button', { name: 'Done' }).click();

            await page.getByRole('button', { name: /^Diagram language:/ }).click();
            await check('language-sheet');
        });
    });
}
