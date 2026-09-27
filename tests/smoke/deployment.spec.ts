import {
    chooseLanguage,
    expect,
    languageButton,
    openTab,
    renderedDiagram,
    saveScreenshot,
    test,
} from '../e2e/fixtures';

// A first visit to a real deployment: the consent question, a local render,
// and a shell that survives reloads without logging an error.
test('a first visit renders a diagram and survives reloads', async ({ page, layout }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Keep diagrams where you expect' })).toBeVisible();
    await page.getByRole('button', { name: 'Render locally only' }).click();
    await chooseLanguage(page, 'GraphViz');
    if (layout === 'compact') await openTab(page, 'Preview');
    await expect(renderedDiagram(page)).toBeVisible();

    for (let reload = 0; reload < 2; reload += 1) {
        await page.reload();
        await expect(languageButton(page)).toHaveAccessibleName('Diagram language: GraphViz');
        await expect(renderedDiagram(page)).toBeVisible();
    }
    await saveScreenshot(page, `smoke-${testInfo.project.name}`);
});
