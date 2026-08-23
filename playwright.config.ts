import { defineConfig, devices } from '@playwright/test';

const renderProxyTarget = process.env.NEOLESK_KROKI_PROXY_TARGET
    || 'https://diagrams.darrengruber.com/render/';

export default defineConfig({
    testDir: './tests/corpus',
    snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
    timeout: 15 * 60 * 1000,
    expect: { timeout: 30_000 },
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
        : 'line',
    use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: 'http://127.0.0.1:4173',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            ...process.env,
            NEOLESK_CACHE_SKIP: '1',
            NEOLESK_KROKI_ENGINE: 'http://127.0.0.1:4173/render/',
            NEOLESK_KROKI_PROXY_TARGET: renderProxyTarget,
        },
    },
});
