import { describe, expect, it } from 'vitest';
import { validateDiagramText } from './diagramLanguageRegistry';

describe('diagram validation', () => {
    it('flags invalid JSON-backed diagrams locally', () => {
        const markers = validateDiagramText('vega', '{');

        expect(markers).toHaveLength(1);
        expect(markers[0].message).toMatch(/json/i);
    });

    it('flags invalid YAML-backed diagrams locally', () => {
        const markers = validateDiagramText('wireviz', 'connectors:\n  X1: [');

        expect(markers.length).toBeGreaterThan(0);
    });

    it('flags incomplete PlantUML fences locally', () => {
        const markers = validateDiagramText('plantuml', '@startuml\nAlice -> Bob');

        expect(markers).toEqual([
            expect.objectContaining({
                message: expect.stringContaining('@enduml'),
            }),
        ]);
    });

    it('flags invalid Mermaid entrypoints locally', () => {
        const markers = validateDiagramText('mermaid', 'Alice -> Bob');

        expect(markers).toEqual([
            expect.objectContaining({
                message: expect.stringContaining('top-level'),
            }),
        ]);
    });

    it('flags unclosed Nomnoml classifiers locally', () => {
        const markers = validateDiagramText('nomnoml', '[Pirate|eyeCount: Int');

        expect(markers).toEqual([
            expect.objectContaining({
                message: expect.stringContaining("Missing closing ']'"),
            }),
        ]);
    });
});
