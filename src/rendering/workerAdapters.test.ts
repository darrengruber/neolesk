import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    pikchr: vi.fn(async (_source: string) => '<svg/>'),
    plantUml: vi.fn((_lines: string[], success: (svg: string) => void, _failure: (message: string) => void) => {
        success('<svg/>');
    }),
}));

// The real runtimes are static workerd WASM modules; these tests cover the adapter seam.
vi.mock('./workerRuntimes', () => ({
    renderWorkerPikchr: runtime.pikchr,
    loadWorkerViz: async () => ({}),
    installWorkerPlantUmlPlatform: () => undefined,
}));
vi.mock('@plantuml/core', () => ({ renderToString: runtime.plantUml }));

const { workerRendererAdapters } = await import('./workerAdapters');
const adapter = (id: string) => {
    const found = workerRendererAdapters.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Missing adapter ${id}`);
    return found;
};

const PLANTUML_SYNTAX_ERROR = '<svg xmlns="http://www.w3.org/2000/svg"><g>'
    + '<text x="5" y="17" fill="#33FF02">PlantUML version $version$</text>'
    + '<text x="6" y="76" fill="#000000">[From textarea (line 2) ]</text>'
    + '<text x="5" y="122" fill="#33FF02" text-decoration="wavy underline">class A {</text>'
    + '<text x="5" y="136" fill="#FF0000"> Syntax Error? (Assumed diagram type: sequence)</text>'
    + '</g></svg>';

describe('Worker renderer adapters', () => {
    beforeEach(() => {
        runtime.pikchr.mockReset();
        runtime.plantUml.mockReset();
    });

    it('turns a Pikchr error block into a render failure with its line', async () => {
        runtime.pikchr.mockResolvedValue('<div><pre>\n/*    1 */  box "unterminated\n'
            + '               ^^^^^^^^^^^^^\nERROR: unrecognized token\n</pre></div>\n');

        await expect(adapter('pikchr-worker').render({
            language: 'pikchr', source: 'box "unterminated', format: 'svg', options: {},
        })).rejects.toThrow('unrecognized token (line 1)');
    });

    it('returns valid Pikchr SVG unchanged', async () => {
        runtime.pikchr.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

        await expect(adapter('pikchr-worker').render({
            language: 'pikchr', source: 'box', format: 'svg', options: {},
        })).resolves.toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    });

    it('turns a PlantUML error diagram into a render failure so Kroki can report it', async () => {
        runtime.plantUml.mockImplementation((_lines, success) => success(PLANTUML_SYNTAX_ERROR));
        const plantUml = adapter('plantuml-worker');

        await expect(plantUml.render({
            language: 'plantuml', source: '@startuml\nclass A {\n@enduml', format: 'svg', options: {},
        })).rejects.toThrow('Syntax Error? (Assumed diagram type: sequence) (line 2)');
        expect(plantUml.remoteOnError).toBe(true);
    });

    it('wraps a PlantUML body without an @start line, as Kroki does', async () => {
        runtime.plantUml.mockImplementation((_lines, success) => success('<svg/>'));

        await adapter('plantuml-worker').render({
            language: 'plantuml', source: 'skinparam monochrome true\nBob -> Alice', format: 'svg', options: {},
        });
        await adapter('plantuml-worker').render({
            language: 'plantuml', source: '@startuml\nBob -> Alice\n@enduml', format: 'svg', options: {},
        });

        expect(runtime.plantUml.mock.calls[0][0]).toEqual([
            '@startuml', 'skinparam monochrome true', 'Bob -> Alice', '@enduml',
        ]);
        expect(runtime.plantUml.mock.calls[1][0]).toEqual(['@startuml', 'Bob -> Alice', '@enduml']);
    });

    it('reports source lines, not wrapper lines, for a wrapped PlantUML body', async () => {
        runtime.plantUml.mockImplementation((_lines, success) => success(PLANTUML_SYNTAX_ERROR));

        await expect(adapter('plantuml-worker').render({
            language: 'plantuml', source: 'class A {', format: 'svg', options: {},
        })).rejects.toThrow('(line 1)');
    });

    it('treats the "not supported" picture for Salt as a rejection so the server can draw it', async () => {
        runtime.plantUml.mockImplementation((_lines, success) => success('<svg><g>'
            + '<text>Diagram not supported by this release of PlantUML</text><text> </text>'
            + '<text>Sorry, but the following directive </text><text>@startsalt</text>'
            + '<text> is not recognized.</text></g></svg>'));

        await expect(adapter('plantuml-worker').render({
            language: 'plantuml', source: '@startsalt\n{ [OK] }\n@endsalt', format: 'svg', options: {},
        })).rejects.toThrow('The PlantUML MIT build does not support @startsalt. A render server can draw it.');
    });

    it('keeps an ordinary PlantUML diagram that happens to contain red text', async () => {
        const svg = '<svg><text fill="#FF0000">Alice</text><text>[From here]</text></svg>';
        runtime.plantUml.mockImplementation((_lines, success) => success(svg));

        await expect(adapter('plantuml-worker').render({
            language: 'plantuml', source: 'Alice -> Bob', format: 'svg', options: {},
        })).resolves.toBe(svg);
    });
});
