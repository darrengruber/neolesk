import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PREFERENCES_KEY } from '../../src/preferences/preferences';
import { layoutForWidth, type LayoutClass } from '../../src/ui/model';

export { expect };

export const SCREENSHOT_DIR = 'test-results/e2e-screens';

/** Console errors a test causes on purpose, matched on the message text. */
export interface ConsoleAllowance {
    allow: RegExp[];
}

interface Fixtures {
    allowedConsoleErrors: ConsoleAllowance;
    layout: LayoutClass;
}

/**
 * Every test fails on an uncaught page error or an unexpected console error,
 * so a journey cannot pass while the app is quietly broken.
 */
export const test = base.extend<Fixtures>({
    allowedConsoleErrors: [{ allow: [] }, { option: true }],
    layout: async ({ viewport }, use) => {
        await use(layoutForWidth(viewport?.width ?? 1280));
    },
    page: async ({ page, allowedConsoleErrors }, use) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const text = message.text();
            if (allowedConsoleErrors.allow.some((pattern) => pattern.test(text))) return;
            errors.push(`console error: ${text}`);
        });
        await use(page);
        expect(errors, 'the page logged no errors').toEqual([]);
    },
});

export type Appearance = 'auto' | 'light' | 'dark';

/** Skip the first-run question with a local-only choice, as a returning visitor would. */
export const rememberLocalRendering = (page: Page, appearance: Appearance = 'auto') => page.addInitScript(
    ({ key, value }) => {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    },
    {
        key: PREFERENCES_KEY,
        value: JSON.stringify({
            appearance,
            editorWrapping: true,
            remoteRendering: 'local-only',
            consentedRenderServer: null,
            transparency: 0.72,
        }),
    },
);

export const editorSource = (page: Page) => page.getByRole('textbox', { name: 'Diagram source' });
export const languageButton = (page: Page) => page.getByRole('button', { name: /^Diagram language:/ });
export const preview = (page: Page) => page.getByRole('region', { name: 'Diagram preview' });
export const renderedDiagram = (page: Page) => preview(page).getByRole('img', { name: 'Rendered diagram' });

/** Open a tab on touch layouts. The wide layout shows everything at once. */
export const openTab = async (page: Page, name: string) => {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
};

export const openShareSheet = async (page: Page, layout: LayoutClass) => {
    const invoker = layout === 'wide'
        ? page.getByRole('button', { name: 'Export', exact: true })
        : page.getByRole('button', { name: 'Share and export' });
    await invoker.click();
    const sheet = page.getByRole('dialog', { name: 'Share and Export' });
    await expect(sheet).toBeVisible();
    return { invoker, sheet };
};

export const chooseLanguage = async (page: Page, name: string) => {
    await languageButton(page).click();
    const sheet = page.getByRole('dialog', { name: 'Diagram Language' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('searchbox', { name: 'Search languages' }).fill(name);
    // The radio input is visually hidden inside its row; tap the row label.
    await sheet.getByText(name, { exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(languageButton(page)).toHaveAccessibleName(`Diagram language: ${name}`);
};

/** Replace the editor contents the way a person would: select all, then type. */
export const replaceSource = async (page: Page, text: string) => {
    const source = editorSource(page);
    await source.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    if (text) await page.keyboard.insertText(text);
};

/** Wait for finite animations so a screenshot or measurement is not mid-flight. */
export const settle = (page: Page) => page.evaluate(() => Promise.all(
    document.getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => null)),
));

export const expectTouchTarget = async (locator: Locator, label: string) => {
    const box = await locator.boundingBox();
    expect(box, `${label} is on screen`).not.toBeNull();
    // Centred controls land on sub-pixel positions; allow for rounding only.
    expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.5);
    expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.5);
};

export const axeViolations = async (page: Page) => {
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.slice(0, 5).map((node) => `${node.target.join(' ')} — ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`),
    }));
};

export const saveScreenshot = async (page: Page, name: string) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await settle(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
};
