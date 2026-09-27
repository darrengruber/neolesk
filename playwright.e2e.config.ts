import { defineConfig, devices } from '@playwright/test';

// User-journey proof for the HIG shell (ADR 0019). Every journey runs on an
// iPhone in WebKit, an iPad in WebKit and a desktop Chromium window, against a
// production build served in-process. No render server is involved: the
// journeys use languages that render in the browser.
export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './test-results/e2e',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: true,
    workers: process.env.CI ? 2 : 4,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [['line'], ['html', { outputFolder: 'playwright-report/e2e', open: 'never' }]]
        : 'line',
    use: {
        baseURL: 'http://127.0.0.1:4174',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        { name: 'iphone-webkit', use: { ...devices['iPhone 15 Pro'] } },
        { name: 'ipad-webkit', use: { ...devices['iPad Mini'] } },
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 } } },
    ],
    webServer: {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort',
        url: 'http://127.0.0.1:4174',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
            ...process.env,
            NEOLESK_CACHE_SKIP: '1',
            NEOLESK_KROKI_ENGINE: 'http://127.0.0.1:4174/render/',
        },
    },
});
