import { describe, expect, it, vi } from 'vitest';
import {
    createRendererCatalog,
    createRenderingModule,
    type RendererAdapter,
} from './rendering';
import { createKrokiRemoteRenderer } from './remote';

const localRenderer = (overrides: Partial<RendererAdapter> = {}): RendererAdapter => ({
    id: 'plantuml-browser',
    label: 'PlantUML browser renderer',
    environments: ['browser', 'worker'],
    languages: ['plantuml', 'c4plantuml'],
    formats: ['svg'],
    render: vi.fn(async () => '<svg data-renderer="plantuml-browser" />'),
    ...overrides,
});

describe('rendering module', () => {
    it('resolves a diagram language to its renderer and reports local provenance', async () => {
        const renderer = localRenderer();
        const module = createRenderingModule({
            catalog: createRendererCatalog([renderer]),
            environment: 'browser',
            remoteRender: vi.fn(),
        });

        const result = await module.render({
            language: 'c4plantuml',
            source: '@startuml\nAlice -> Bob\n@enduml',
            format: 'svg',
            remote: null,
        });

        expect(result).toEqual({
            data: '<svg data-renderer="plantuml-browser" />',
            diagnostics: [],
            provenance: {
                kind: 'local',
                rendererId: 'plantuml-browser',
                rendererLabel: 'PlantUML browser renderer',
                options: {},
            },
        });
    });

    it('uses the consented render server when a local renderer fails', async () => {
        const renderer = localRenderer({
            render: vi.fn(async () => {
                throw new Error('MIT build does not support this source');
            }),
        });
        const remoteRender = vi.fn(async () => '<svg data-renderer="server" />');
        const module = createRenderingModule({
            catalog: createRendererCatalog([renderer]),
            environment: 'browser',
            remoteRender,
        });

        const result = await module.render({
            language: 'plantuml',
            source: '@startuml\nditaa\n@enduml',
            format: 'svg',
            remote: createKrokiRemoteRenderer({
                id: 'neolesk',
                label: "neolesk's renderer",
                url: 'https://diagrams.darrengruber.com/render/',
            }),
        });

        expect(remoteRender).toHaveBeenCalledWith({
            format: 'svg',
            language: 'plantuml',
            options: {},
            serverUrl: 'https://diagrams.darrengruber.com/render/',
            source: '@startuml\nditaa\n@enduml',
        });
        expect(result.provenance).toEqual({
            kind: 'remote',
            rendererId: 'neolesk',
            rendererLabel: "neolesk's renderer",
            serverUrl: 'https://diagrams.darrengruber.com/render/',
            options: {},
        });
        expect(result.diagnostics).toEqual([{
            kind: 'fallback',
            message: 'MIT build does not support this source',
            rendererId: 'plantuml-browser',
        }]);
    });

    it('does not send diagram source without consent', async () => {
        const remoteRender = vi.fn();
        const module = createRenderingModule({
            catalog: createRendererCatalog([]),
            environment: 'browser',
            remoteRender,
        });

        await expect(module.render({
            language: 'ditaa',
            source: '+---+',
            format: 'svg',
            remote: null,
        })).rejects.toMatchObject({
            code: 'REMOTE_CONSENT_REQUIRED',
            language: 'ditaa',
        });
        expect(remoteRender).not.toHaveBeenCalled();
    });

    it('renders remotely while a consented heavy renderer warms, then stays local', async () => {
        let finishWarm: (() => void) | undefined;
        const renderer = localRenderer({
            remoteWhileLoading: true,
            load: vi.fn(() => new Promise<void>((resolve) => { finishWarm = resolve; })),
        });
        const remoteRender = vi.fn(async () => '<svg data-renderer="server" />');
        const module = createRenderingModule({
            catalog: createRendererCatalog([renderer]),
            environment: 'browser',
            remoteRender,
        });
        const request = {
            language: 'plantuml',
            source: '@startuml\nAlice -> Bob\n@enduml',
            format: 'svg',
            remote: createKrokiRemoteRenderer({
                id: 'neolesk', label: "neolesk's renderer", url: 'https://example.test/render/',
            }),
        };

        await expect(module.render(request)).resolves.toMatchObject({
            provenance: { kind: 'remote', rendererId: 'neolesk' },
        });
        expect(renderer.render).not.toHaveBeenCalled();

        finishWarm?.();
        await vi.waitFor(() => expect(renderer.load).toHaveBeenCalledOnce());
        await Promise.resolve();

        await expect(module.render(request)).resolves.toMatchObject({
            provenance: { kind: 'local', rendererId: 'plantuml-browser' },
        });
    });

    it('exposes capabilities without loading a renderer', () => {
        const load = vi.fn();
        const renderer = localRenderer({
            load,
            optionDefinitions: {
                layout: { type: 'enum', values: ['dot', 'neato'] },
            },
        });
        const module = createRenderingModule({
            catalog: createRendererCatalog([renderer]),
            environment: 'worker',
            remoteRender: vi.fn(),
        });

        expect(module.getCapabilities('plantuml')).toEqual({
            language: 'plantuml',
            local: true,
            rendererIds: ['plantuml-browser'],
            formats: ['svg'],
            optionDefinitions: {
                layout: { type: 'enum', values: ['dot', 'neato'] },
            },
        });
        expect(load).not.toHaveBeenCalled();
    });

    it('validates renderer options against the declared capability schema', () => {
        const catalog = createRendererCatalog([localRenderer({
            optionDefinitions: {
                layout: { type: 'enum', values: ['dagre', 'elk'] },
                sketch: { type: 'boolean' },
                pad: { type: 'number', minimum: 0, maximum: 100 },
            },
        })]);

        expect(catalog.validateOptions('plantuml', 'worker', {
            layout: 'elk', sketch: 'true', pad: '24',
        })).toEqual({ layout: 'elk', sketch: 'true', pad: '24' });
        expect(() => catalog.validateOptions('plantuml', 'worker', { layout: '//evil' }))
            .toThrow('Unsupported value for renderer option layout');
        expect(() => catalog.validateOptions('plantuml', 'worker', { invented: 'yes' }))
            .toThrow('Unsupported renderer option invented');
    });

    it('validates the language, format, and options declared by the selected remote renderer', async () => {
        const remoteRender = vi.fn(async () => '<svg />');
        const module = createRenderingModule({
            catalog: createRendererCatalog([]), environment: 'worker', remoteRender,
        });
        const remote = {
            id: 'kroki-io', label: 'kroki.io', url: 'https://kroki.io/',
            capabilities: {
                d2: {
                    formats: ['svg'],
                    optionDefinitions: { layout: { type: 'enum' as const, values: ['dagre', 'elk'] } },
                },
            },
        };

        await expect(module.render({
            language: 'd2', source: 'a -> b', format: 'svg', options: { layout: 'elk' }, remote,
        })).resolves.toEqual(expect.objectContaining({
            provenance: expect.objectContaining({ rendererId: 'kroki-io', options: { layout: 'elk' } }),
        }));
        await expect(module.render({
            language: 'd2', source: 'a', format: 'svg', options: { layout: 'invented' }, remote,
        })).rejects.toThrow('Unsupported value for renderer option layout');
        await expect(module.render({
            language: 'plantuml', source: '@startuml\n@enduml', format: 'svg', remote,
        })).rejects.toThrow('does not support plantuml as svg');
        expect(remoteRender).toHaveBeenCalledOnce();
    });

    it('does not advertise a D2 layout that the Worker cannot execute in-cell', async () => {
        const local = localRenderer({
            languages: ['d2'],
            optionDefinitions: { layout: { type: 'enum', values: ['dagre'] } },
        });
        const remoteRender = vi.fn(async () => '<svg data-layout="elk" />');
        const module = createRenderingModule({
            catalog: createRendererCatalog([local]), environment: 'worker', remoteRender,
        });
        const remote = createKrokiRemoteRenderer({
            id: 'neolesk', label: 'neolesk Kroki', url: 'https://example.test/render/',
        });

        await expect(module.render({
            language: 'd2', source: 'a -> b', format: 'svg', options: { layout: 'elk' }, remote,
        })).rejects.toThrow('Unsupported value for renderer option layout');
        expect(local.render).not.toHaveBeenCalled();
        expect(remoteRender).not.toHaveBeenCalled();
    });
});
