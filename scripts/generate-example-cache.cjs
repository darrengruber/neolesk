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

const renderUrl = `${process.env.NEOLESK_KROKI_ENGINE || defaultRenderUrl}`.replace(/\/?$/, '/');
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
            // Only for humans reading a failure. "plantuml / Network diagram"
            // is findable in src/examples/catalog/; a content hash is not.
            label: `${example.diagramType} / ${example.description || example.title}`,
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

// Strict mode turns this script from best-effort into a gate.
//
// By default it stays best-effort on purpose: a developer offline, or building
// against an engine that is briefly down, should still get a working dev server
// — the app renders live and only loses the pre-baked example thumbnails.
//
// CI sets NEOLESK_CACHE_STRICT=1, and then a single example that will not
// render fails the build. Without that, the previous behaviour was to warn into
// a build log nobody reads and exit 0, which is how a broken PlantUML example
// shipped to production and stayed there until someone rendered the corpus by
// hand. An existing cache file also counted as success, so a once-good example
// that upstream later broke never re-surfaced.
const strict = process.env.NEOLESK_CACHE_STRICT === '1';

const main = async () => {
    const examples = loadExamples();
    const entries = buildEntries(examples);

    syncExistingFiles(entries);

    const failures = [];

    await runWithConcurrency(entries, async (entry) => {
        const cached = await cacheMissingEntry(entry);
        if (!cached && !fs.existsSync(path.join(cacheDir, entry.filename))) {
            failures.push(entry);
        }
    }, concurrency);

    const ready = entries.length - failures.length;
    console.log(`[examples:cache] ${ready}/${entries.length} example renders available`);

    if (failures.length === 0) {
        return;
    }

    for (const entry of failures) {
        console.warn(`[examples:cache] no render for ${entry.label}`);
    }

    if (strict) {
        console.error(
            `[examples:cache] ${failures.length} example(s) do not render against ${renderUrl}. ` +
            'Fix the example or the engine — do not ship a diagram editor that cannot draw its own examples.',
        );
        process.exitCode = 1;
    }
};

main().catch((error) => {
    // An unexpected crash (bad catalog, unreadable cache dir) is a real defect.
    // It used to be pinned to exit 0, so CI could not see it either.
    console.error(`[examples:cache] Unexpected failure: ${error.stack || error.message}`);
    process.exitCode = strict ? 1 : 0;
});
