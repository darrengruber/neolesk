import { describe, expect, it } from 'vitest';
import type { DiagramTypeMap, ExampleRecord } from '../types';
import {
    exportFormatNote,
    filterLanguages,
    formatZoom,
    groupExamples,
    hostOf,
    languageSummaries,
    layoutForWidth,
    pinchZoom,
    presenceText,
    stepZoom,
    tabsForLayout,
    zoomValueText,
} from './model';

const diagramTypes: DiagramTypeMap = {
    plantuml: { name: 'PlantUML', example: '', language: null, filetypes: ['svg'] },
    mermaid: { name: 'Mermaid', example: '', language: null, filetypes: ['svg'] },
    d2: { name: 'D2', example: '', language: null, filetypes: ['svg'] },
    tikz: { name: 'TikZ', example: '', language: null, filetypes: ['svg'] },
};

const example = (id: number, diagramType: string, title: string, description: string): ExampleRecord => ({
    id,
    diagramType,
    title,
    description,
    default: false,
    example: '',
    url: '',
    searchField: `${title} ${description}`.toLowerCase(),
});

describe('layoutForWidth', () => {
    it('uses the compact tab layout below the iPad regular width', () => {
        expect(layoutForWidth(320)).toBe('compact');
        expect(layoutForWidth(767)).toBe('compact');
    });

    it('uses a split editor at regular width and the full workspace from 1100 px', () => {
        expect(layoutForWidth(768)).toBe('regular');
        expect(layoutForWidth(1099)).toBe('regular');
        expect(layoutForWidth(1100)).toBe('wide');
    });
});

describe('tabsForLayout', () => {
    it('gives compact screens one tab per section', () => {
        expect(tabsForLayout('compact').map((tab) => tab.label)).toEqual(['Code', 'Preview', 'Examples', 'Settings']);
    });

    it('merges code and preview into one editor tab at regular width', () => {
        const tabs = tabsForLayout('regular');
        expect(tabs.map((tab) => tab.label)).toEqual(['Editor', 'Examples', 'Settings']);
        expect(tabs[0].panels).toEqual(['code', 'preview']);
    });
});

describe('zoom', () => {
    it('steps in quarter increments and snaps a pinched value back onto the grid', () => {
        expect(stepZoom(1, 1)).toBe(1.25);
        expect(stepZoom(1, -1)).toBe(0.75);
        expect(stepZoom(1.1, 1)).toBe(1.25);
        expect(stepZoom(1.1, -1)).toBe(1);
    });

    it('never leaves the 25 to 400 percent range', () => {
        expect(stepZoom(0.25, -1)).toBe(0.25);
        expect(stepZoom(4, 1)).toBe(4);
        expect(pinchZoom(1, 100, 10_000)).toBe(4);
        expect(pinchZoom(1, 100, 1)).toBe(0.25);
    });

    it('scales with the ratio of finger distances', () => {
        expect(pinchZoom(1, 100, 150)).toBeCloseTo(1.5);
        expect(pinchZoom(2, 200, 100)).toBeCloseTo(1);
        expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
    });

    it('writes the value for the eye and for the ear', () => {
        expect(formatZoom(1.25)).toBe('125%');
        expect(zoomValueText(1.25)).toBe('125 percent');
    });
});

describe('groupExamples', () => {
    const examples = [
        example(0, 'plantuml', 'PlantUML', 'Sequence diagram'),
        example(1, 'mermaid', 'Mermaid', 'Flowchart'),
        example(2, 'plantuml', 'PlantUML', 'Class diagram'),
        example(3, 'd2', 'D2', 'Default'),
    ];

    it('groups by diagram language in a stable alphabetical order', () => {
        const groups = groupExamples(examples, '', diagramTypes);
        expect(groups.map((group) => group.name)).toEqual(['D2', 'Mermaid', 'PlantUML']);
        expect(groups[2].examples.map((item) => item.description)).toEqual(['Sequence diagram', 'Class diagram']);
    });

    it('narrows by every search word and drops empty groups', () => {
        const groups = groupExamples(examples, 'class plantuml', diagramTypes);
        expect(groups).toHaveLength(1);
        expect(groups[0].examples.map((item) => item.id)).toEqual([2]);
        expect(groupExamples(examples, 'zzz', diagramTypes)).toEqual([]);
    });

    it('matches the language name even when an example title does not carry it', () => {
        const groups = groupExamples([example(9, 'mermaid', 'Pie', 'Pets')], 'mermaid', diagramTypes);
        expect(groups.map((group) => group.id)).toEqual(['mermaid']);
    });
});

describe('languageSummaries', () => {
    it('lists each language once with its example count, current language first', () => {
        const examples = [
            example(0, 'plantuml', 'PlantUML', 'Sequence diagram'),
            example(1, 'mermaid', 'Mermaid', 'Flowchart'),
            example(2, 'plantuml', 'PlantUML', 'Class diagram'),
            example(3, 'd2', 'D2', 'Default'),
        ];
        expect(languageSummaries(examples, diagramTypes, 'mermaid')).toEqual({
            current: { id: 'mermaid', name: 'Mermaid', count: 1 },
            others: [
                { id: 'd2', name: 'D2', count: 1 },
                { id: 'plantuml', name: 'PlantUML', count: 2 },
            ],
        });
    });

    it('has no current entry when the language has no examples', () => {
        expect(languageSummaries([], diagramTypes, 'tikz')).toEqual({ current: null, others: [] });
    });
});

describe('filterLanguages', () => {
    const isLocal = (id: string) => id !== 'tikz';

    it('splits languages by where they render, sorted by name', () => {
        const sections = filterLanguages(diagramTypes, '', isLocal);
        expect(sections.map((section) => section.title)).toEqual(['On This Device', 'Needs a Render Server']);
        expect(sections[0].languages.map((language) => language.name)).toEqual(['D2', 'Mermaid', 'PlantUML']);
        expect(sections[1].languages.map((language) => language.id)).toEqual(['tikz']);
    });

    it('filters by name or identifier and hides an empty section', () => {
        expect(filterLanguages(diagramTypes, 'plant', isLocal).map((section) => section.languages.length)).toEqual([1]);
        expect(filterLanguages(diagramTypes, 'TIKZ', isLocal).map((section) => section.title)).toEqual(['Needs a Render Server']);
        expect(filterLanguages(diagramTypes, 'nothing', isLocal)).toEqual([]);
    });
});

describe('wording', () => {
    it('says who is connected in words, not only with a coloured dot', () => {
        expect(presenceText('person', 'connected')).toBe('Connected');
        expect(presenceText('person', 'disconnected')).toBe('Reconnecting');
        expect(presenceText('agent', 'connected')).toBe('Agent connected');
        expect(presenceText('agent', 'offline')).toBe('Agent offline');
    });

    it('names a render server by its host, and survives a malformed URL', () => {
        expect(hostOf('https://diagrams.example/render/')).toBe('diagrams.example');
        expect(hostOf('not a url')).toBe('not a url');
    });

    it('explains why a file export is not available', () => {
        expect(exportFormatNote('svg', false)).toBeNull();
        expect(exportFormatNote('png', false)).toBe('Needs a render server');
        expect(exportFormatNote('pdf', true)).toBeNull();
    });
});
