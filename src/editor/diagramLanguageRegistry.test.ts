import { describe, expect, it } from 'vitest';
import { diagramTypes } from '../state';
import {
    getCompletionCountByDiagramType,
    getEditorLanguageId,
    getSupportedDiagramTypes,
} from './diagramLanguageRegistry';

describe('diagramLanguageRegistry', () => {
    it('covers every supported diagram type', () => {
        expect(getSupportedDiagramTypes().sort()).toEqual(Object.keys(diagramTypes).sort());
    });

    it('provides a language id and completions for every supported diagram type', () => {
        const completionCounts = getCompletionCountByDiagramType();

        Object.entries(diagramTypes).forEach(([diagramType, definition]) => {
            expect(getEditorLanguageId(diagramType, definition.language)).toBeTruthy();
            expect(completionCounts[diagramType]).toBeGreaterThan(0);
        });
    });
});
