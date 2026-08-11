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
            diagramType: example.diagramType,
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

// Outcomes are classified rather than pass/fail, because WHOSE fault a failure
// is decides whether CI should block on it:
//
//   'ok'     rendered (or already cached)
//   'source' the engine rejected the diagram — 4xx. This is OUR bug: a broken
//            example, exactly like the PlantUML nwdiag one that shipped and
//            stayed shipped. Strict mode fails on these.
//   'engine' the engine failed or was unreachable — 5xx, network, or a 200
//            with no SVG in it. NOT our bug, and not stable enough to gate a
//            merge on: kroki.io renders a different subset of mermaid from one
//            hour to the next. Strict mode reports these and moves on.
//
// Getting this split wrong in either direction is costly. Blocking on 'engine'
// makes CI fail for reasons nobody in this repo can fix; ignoring 'source'
// re-opens the hole this whole mechanism exists to close.
const cacheMissingEntry = async (entry) => {
    const outputPath = path.join(cacheDir, entry.filename);
    if (fs.existsSync(outputPath)) {
        return 'ok';
    }

    try {
        const response = await fetch(entry.url);
        if (!response.ok) {
            console.warn(`[examples:cache] ${response.status} ${response.statusText} for ${entry.url}`);
            return response.status >= 400 && response.status < 500 ? 'source' : 'engine';
        }

        const svg = await response.text();
        if (!svg.includes('<svg')) {
            console.warn(`[examples:cache] Unexpected response body for ${entry.url}`);
            return 'engine';
        }

        fs.writeFileSync(outputPath, svg);
        return 'ok';
    } catch (error) {
        console.warn(`[examples:cache] Failed to fetch ${entry.url}: ${error.message}`);
        return 'engine';
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

// Diagram types the TARGET ENGINE is known not to support, comma-separated.
// Strict mode ignores failures for these and fails on everything else.
//
// This exists because the two deployments of this app use different engines,
// and each should be gated against the one it actually calls:
//
//   * the public Cloudflare Pages site uses kroki.io, which cannot render
//     `diagramsnet` at all (it answers 503 Connection refused for it, exactly
//     as our own instance did before its companion service was added) — so CI
//     runs with NEOLESK_CACHE_ALLOW_FAIL=diagramsnet;
//   * the in-cluster image builds against our own kroki, which renders all 29
//     types, and allows nothing.
//
// Keep this list as short as the engine forces it to be. It is an admission
// that a feature is unavailable on a target, not a way to silence a real break.
const allowFail = new Set(
    (process.env.NEOLESK_CACHE_ALLOW_FAIL || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
);

const main = async () => {
    const examples = loadExamples();
    const entries = buildEntries(examples);

    syncExistingFiles(entries);

    const failures = [];

    await runWithConcurrency(entries, async (entry) => {
        const outcome = await cacheMissingEntry(entry);
        if (outcome !== 'ok' && !fs.existsSync(path.join(cacheDir, entry.filename))) {
            failures.push({ ...entry, outcome });
        }
    }, concurrency);

    const ready = entries.length - failures.length;
    console.log(`[examples:cache] ${ready}/${entries.length} example renders available`);

    if (failures.length === 0) {
        return;
    }

    const broken = [];
    const degraded = [];

    for (const entry of failures) {
        if (allowFail.has(entry.diagramType)) {
            console.warn(`[examples:cache] ${entry.label}: skipped, engine does not support this type`);
        } else if (entry.outcome === 'source') {
            console.warn(`[examples:cache] ${entry.label}: THE ENGINE REJECTED THE SOURCE — fix the example`);
            broken.push(entry);
        } else {
            console.warn(`[examples:cache] ${entry.label}: engine failed or was unreachable`);
            degraded.push(entry);
        }
    }

    if (degraded.length > 0) {
        console.warn(
            `[examples:cache] ${degraded.length} example(s) failed because ${renderUrl} did not ` +
            'answer properly. Not failing on that — it is not something this repo can fix.',
        );
    }

    if (strict && broken.length > 0) {
        console.error(
            `[examples:cache] ${broken.length} example(s) were REJECTED by ${renderUrl}. ` +
            'Do not ship a diagram editor that cannot draw its own examples.',
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
