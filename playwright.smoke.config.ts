import { defineConfig, devices } from '@playwright/test';

// Smoke test of a deployed neolesk: a Pages preview before production, and the
// live site after it (ADR 0020). Point it at the URL under test:
//   NEOLESK_SMOKE_URL=https://<preview>.neolesk-preview.pages.dev npm run test:smoke
const baseURL = process.env.NEOLESK_SMOKE_URL;
if (!baseURL) throw new Error('Set NEOLESK_SMOKE_URL to the deployment under test.');

export default defineConfig({
    testDir: './tests/smoke',
    outputDir: './test-results/smoke',
    timeout: 90_000,
    expect: { timeout: 30_000 },
    retries: 0,
    reporter: 'line',
    use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [
        { name: 'iphone-webkit', use: { ...devices['iPhone 15 Pro'] } },
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 } } },
    ],
});
