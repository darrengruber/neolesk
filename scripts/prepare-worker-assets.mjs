import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = resolve(root, 'src/worker/generated');
await mkdir(generated, { recursive: true });

const extractEmbeddedWasm = async (sourcePath, outputPath) => {
    const source = await readFile(sourcePath, 'utf8');
    const match = source.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/]+={0,2})/);
    if (!match) throw new Error(`Could not find embedded WASM in ${sourcePath}`);
    await writeFile(outputPath, Buffer.from(match[1], 'base64'));
    return { source, embedded: match[1] };
};

const plantUmlVizPath = resolve(root, 'node_modules/@plantuml/core/viz-global.js');
const plantUmlViz = await extractEmbeddedWasm(
    plantUmlVizPath,
    resolve(generated, 'viz-graphviz.wasm'),
);
const patchedViz = plantUmlViz.source
    .replace(plantUmlViz.embedded, '')
    .replace('"object"==typeof exports&&"undefined"!=typeof module?I(exports):', 'false?I(exports):')
    .replace('require("url").pathToFileURL(__filename).href', '"https://worker.invalid/viz-global.js"')
    .replace(
        't(A).then(A=>WebAssembly.instantiate(A,I))',
        'globalThis.__neoleskInstantiateVizWasm(I)',
    );
if (patchedViz === plantUmlViz.source) throw new Error('Could not patch the Viz.js instantiation seam');
await writeFile(resolve(generated, 'viz-runtime.js'), patchedViz);

const pikchrPath = resolve(root, 'node_modules/pikchr-wasm/pikchr/pikchr.speed.js');
const pikchr = await extractEmbeddedWasm(pikchrPath, resolve(generated, 'pikchr.wasm'));
await writeFile(resolve(generated, 'pikchr-runtime.js'), pikchr.source.replace(pikchr.embedded, ''));

await Promise.all([
    copyFile(
        resolve(root, 'node_modules/svgbob-wasm/svgbob_wasm_bg.wasm'),
        resolve(generated, 'svgbob.wasm'),
    ),
    copyFile(
        resolve(root, 'node_modules/@terrastruct/d2/dist/node-esm/d2.wasm'),
        resolve(generated, 'd2.wasm'),
    ),
    copyFile(
        resolve(root, 'node_modules/@terrastruct/d2/dist/node-esm/wasm_exec.js'),
        resolve(generated, 'd2-wasm-exec.js'),
    ),
]);

process.stdout.write('Prepared static Worker WASM modules.\n');
