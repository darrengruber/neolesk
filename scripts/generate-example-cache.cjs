const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const cacheDir = path.join(publicDir, 'cache');
const defaultRenderUrl = 'https://kroki.io/';

// Load .env if present (Vite does this for the app, but this script runs via Node directly)
const dotenvPath = path.join(rootDir, '.env');
if (fs.existsSync(dotenvPath)) {
    for (const line of fs.readFileSync(dotenvPath, 'utf8').split('\n')) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2];
        }
    }
}

// NEOLESK_KROKI_CACHE_URL allows overriding the fetch URL for cache generation
// (e.g. a Tailscale Funnel URL), while NEOLESK_KROKI_ENGINE may be a relative
// path like /kroki/ that only works at runtime in the browser.
const cacheUrl = process.env.NEOLESK_KROKI_CACHE_URL;
const renderUrl = cacheUrl ? `${cacheUrl}`.replace(/\/?$/, '/') : defaultRenderUrl;
const concurrency = 8;

const moduleCache = new Map();

const resolveLocalModule = (specifier, importerDir) => {
    const candidates = [
        path.resolve(importerDir, specifier),
        path.resolve(importerDir, `${specifier}.ts`),
        path.resolve(importerDir, `${specifier}.js`),
        path.resolve(importerDir, specifier, 'index.ts'),
        path.resolve(importerDir, specifier, 'index.js'),
    ];

    const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());

    if (!resolved) {
        throw new Error(`Unable to resolve "${specifier}" from "${importerDir}"`);
    }

    return resolved;
};

const loadTsModule = (modulePath) => {
    const resolvedPath = path.resolve(modulePath);

    if (moduleCache.has(resolvedPath)) {
        return moduleCache.get(resolvedPath);
    }

    const source = fs.readFileSync(resolvedPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: resolvedPath,
    });

    const module = { exports: {} };
    moduleCache.set(resolvedPath, module.exports);

    const localRequire = (specifier) => {
        if (specifier.startsWith('.')) {
            return loadTsModule(resolveLocalModule(specifier, path.dirname(resolvedPath)));
        }

        return require(specifier);
    };

    const wrapper = vm.runInThisContext(
        `(function (require, module, exports, __filename, __dirname) { ${transpiled.outputText}\n})`,
        { filename: resolvedPath },
    );

    wrapper(localRequire, module, module.exports, resolvedPath, path.dirname(resolvedPath));
    moduleCache.set(resolvedPath, module.exports);
    return module.exports;
};

const ensureDirectory = (directoryPath) => {
    fs.mkdirSync(directoryPath, { recursive: true });
};

const loadExamples = () => {
    const examplesModule = loadTsModule(path.join(rootDir, 'src/examples/index.ts'));
    return examplesModule.default || examplesModule;
};

const buildEntries = (examples) => {
    const { getExampleCacheFilename, getExampleRadical } = loadTsModule(path.join(rootDir, 'src/examples/cacheKey.ts'));

    return examples.map((example) => {
        const radical = getExampleRadical(example);
        const filename = getExampleCacheFilename(example);

        return {
            radical,
            filename,
            url: `${renderUrl}${radical}`,
        };
    });
};

const syncExistingFiles = (entries) => {
    ensureDirectory(cacheDir);

    const expected = new Set(entries.map(({ filename }) => filename));
    for (const file of fs.readdirSync(cacheDir)) {
        if (!expected.has(file)) {
            fs.rmSync(path.join(cacheDir, file), { force: true });
        }
    }
};

const cacheMissingEntry = async (entry) => {
    const outputPath = path.join(cacheDir, entry.filename);
    if (fs.existsSync(outputPath)) {
        return true;
    }

    try {
        const response = await fetch(entry.url);
        if (!response.ok) {
            console.warn(`[examples:cache] ${response.status} ${response.statusText} for ${entry.url}`);
            return false;
        }

        const svg = await response.text();
        if (!svg.includes('<svg')) {
            console.warn(`[examples:cache] Unexpected response body for ${entry.url}`);
            return false;
        }

        fs.writeFileSync(outputPath, svg);
        return true;
    } catch (error) {
        console.warn(`[examples:cache] Failed to fetch ${entry.url}: ${error.message}`);
        return false;
    }
};

const runWithConcurrency = async (items, worker, workerCount) => {
    let currentIndex = 0;

    const runners = Array.from({ length: workerCount }, async () => {
        while (currentIndex < items.length) {
            const index = currentIndex;
            currentIndex += 1;
            await worker(items[index]);
        }
    });

    await Promise.all(runners);
};

const main = async () => {
    const examples = loadExamples();
    const entries = buildEntries(examples);

    syncExistingFiles(entries);

    const readyEntries = [];

    await runWithConcurrency(entries, async (entry) => {
        const cached = await cacheMissingEntry(entry);
        if (cached || fs.existsSync(path.join(cacheDir, entry.filename))) {
            readyEntries.push(entry);
        }
    }, concurrency);

    console.log(`[examples:cache] ${readyEntries.length}/${entries.length} example renders available`);
};

main().catch((error) => {
    console.warn(`[examples:cache] Unexpected failure: ${error.message}`);
    process.exitCode = 0;
});
