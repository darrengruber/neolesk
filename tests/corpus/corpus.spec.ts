import { expect, test, type Page } from '@playwright/test';
import examples from '../../src/examples';
import { getExampleCacheFilename, getExampleRadical } from '../../src/examples/cacheKey';
import { browserRendererCatalog } from '../../src/rendering/catalog';
import { PREFERENCES_KEY } from '../../src/preferences/preferences';
import type { ExampleDefinition } from '../../src/types';

const localExamples = examples.filter((example) => browserRendererCatalog.capabilities(
    example.diagramType,
    'browser',
).local);
const remoteExamples = examples.filter((example) => !browserRendererCatalog.capabilities(
    example.diagramType,
    'browser',
).local);

test('the complete 116-example contract is present', () => {
    expect(examples).toHaveLength(116);
    expect(new Set(examples.map(getExampleCacheFilename)).size).toBe(116);
    expect(localExamples.length + remoteExamples.length).toBe(116);
});

const installPreference = (page: Page, remoteRendering: 'local-only' | 'neolesk') => page.addInitScript(
    ({ key, choice }) => localStorage.setItem(key, JSON.stringify({
        appearance: 'light',
        editorWrapping: true,
        remoteRendering: choice,
        transparency: 1,
    })),
    { key: PREFERENCES_KEY, choice: remoteRendering },
);

const captureCorpus = async (page: Page, corpus: ExampleDefinition[]) => {
    const preview = page.getByLabel('Diagram preview');
    const image = preview.getByRole('img', { name: 'Rendered diagram' });
    for (let index = 0; index < corpus.length; index += 1) {
        const example = corpus[index];
        await test.step(`${example.diagramType} / ${example.title}`, async () => {
            const radical = getExampleRadical(example);
            // A changing query parameter forces a document navigation. Hash-only
            // navigation can race the editor's canonical snapshot URL effect and
            // accidentally restart the preceding render.
            await page.goto(`/?corpus=${index}#${radical}`);
            await expect(image).toBeVisible({ timeout: 120_000 });
            await expect(preview).toHaveScreenshot(
                getExampleCacheFilename(example).replace(/\.svg$/, '.png'),
                { animations: 'disabled', maxDiffPixelRatio: 0.001 },
            );
        });
    }
};

test('browser-rendered example corpus matches committed images', async ({ page }) => {
    // Consent enables the ADR 0014 server-on-failure path for valid sources
    // rejected by the thinly exercised PlantUML TeaVM build. All other local
    // adapters remain authoritative once loaded.
    await installPreference(page, 'neolesk');
    await captureCorpus(page, localExamples);
});

test('server-rendered example corpus matches committed images', async ({ page }) => {
    await installPreference(page, 'neolesk');
    await captureCorpus(page, remoteExamples);
});
