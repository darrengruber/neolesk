import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const gitHash = (() => {
    try {
        return execSync('git rev-parse --short=8 HEAD').toString().trim();
    } catch {
        return 'dev';
    }
})();

export default defineConfig({
    base: '/',
    plugins: [react({ include: /\.(js|jsx|ts|tsx)$/ })],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __GIT_HASH__: JSON.stringify(gitHash),
        __KROKI_ENGINE_URL__: JSON.stringify(process.env.NEOLESK_KROKI_ENGINE || 'https://kroki.io/'),
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/setupTests.ts',
        css: true,
    },
});
