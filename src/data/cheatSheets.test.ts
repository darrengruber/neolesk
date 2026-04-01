import { describe, expect, it } from 'vitest';
import cheatSheets from './cheatSheets';
import { diagramTypes } from '../state';
import { validateDiagramText } from '../editor/diagramLanguageRegistry';

const getSectionSnippet = (diagramType: string, heading: string): string => {
    const section = cheatSheets[diagramType]?.sections.find((entry) => entry.heading === heading);
    if (!section) {
        throw new Error(`Missing cheat sheet section "${heading}" for ${diagramType}`);
    }
    return section.items.join('\n');
};

describe('cheat sheets', () => {
    it('covers every supported diagram type', () => {
        expect(Object.keys(cheatSheets).sort()).toEqual(Object.keys(diagramTypes).sort());
    });

    it('keeps starter snippets syntactically valid where validators exist', () => {
        const starterSections: Record<string, string> = {
            actdiag: 'Structure',
            blockdiag: 'Structure',
            bpmn: 'Root element',
            bytefield: 'Basic fields',
            d2: 'Containers',
            dbml: 'Tables',
            diagramsnet: 'Root file',
            excalidraw: 'Root structure',
            graphviz: 'Directed graph',
            mermaid: 'Flowchart',
            nomnoml: 'Nested',
            nwdiag: 'Structure',
            packetdiag: 'Structure',
            plantuml: 'Wrapper',
            rackdiag: 'Structure',
            seqdiag: 'Structure',
            structurizr: 'Workspace',
            tikz: 'Document',
            umlet: 'Root',
            vega: 'Top-level',
            vegalite: 'Basic chart',
            wavedrom: 'Basic signal',
            wireviz: 'Connectors',
        };

        Object.entries(starterSections).forEach(([diagramType, heading]) => {
            expect(validateDiagramText(diagramType, getSectionSnippet(diagramType, heading))).toEqual([]);
        });
    });
});
