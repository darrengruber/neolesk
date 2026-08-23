import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const renderProxy = process.env.NEOLESK_KROKI_PROXY_TARGET ? {
    '/render': {
        target: process.env.NEOLESK_KROKI_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/render/, ''),
    },
} : undefined;

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
            config.renderServerUrl = process.env.NEOLESK_KROKI_ENGINE;
        }
        if (process.env.NEOLESK_SESSION_BACKEND) {
            config.sessionBackendUrl = process.env.NEOLESK_SESSION_BACKEND;
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
        wasm(),
        react({ include: /\.(js|jsx|ts|tsx)$/ }),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __GIT_HASH__: JSON.stringify(gitHash),
        __KROKI_ENGINE_URL__: JSON.stringify(process.env.NEOLESK_KROKI_ENGINE || 'https://diagrams.darrengruber.com/render/'),
    },
    build: {
        target: 'esnext',
    },
    server: renderProxy ? { proxy: renderProxy } : undefined,
    preview: renderProxy ? { proxy: renderProxy } : undefined,
    resolve: {
        alias: {
            // Browser-native engine deps reference Node built-ins that are never
            // reached at runtime (nomnoml's compileFile, viz.js render_sync,
            // sax stream mode). Alias to empty modules to suppress Vite warnings.
            fs: resolve('src/engines/empty-module.mjs'),
            path: resolve('src/engines/empty-module.mjs'),
            stream: resolve('src/engines/empty-module.mjs'),
            crypto: resolve('src/engines/empty-module.mjs'),
        },
    },
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
        environment: 'jsdom',
        environmentOptions: {
            jsdom: { url: 'http://localhost/' },
        },
        globals: true,
        setupFiles: './src/setupTests.ts',
        css: true,
    },
});
