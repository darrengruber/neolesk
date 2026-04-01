import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** Generate public/config.json from .env values so the app can read them at runtime. */
function runtimeConfigPlugin() {
    const configPath = resolve('public/config.json');

    function generate() {
        const config = {};
        if (process.env.NEOLESK_KROKI_ENGINE) {
            config.krokiEngineUrl = process.env.NEOLESK_KROKI_ENGINE;
        }
        if (process.env.NEOLESK_RELAY_URL) {
            config.relayUrl = process.env.NEOLESK_RELAY_URL;
        }
        if (Object.keys(config).length > 0) {
            writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        } else if (existsSync(configPath)) {
            rmSync(configPath);
        }
    }

    return {
        name: 'runtime-config',
        buildStart() { generate(); },
        configureServer() { generate(); },
    };
}

export default defineConfig({
    base: '/',
    plugins: [
        runtimeConfigPlugin(),
        react({ include: /\.(js|jsx|ts|tsx)$/ }),
    ],
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
