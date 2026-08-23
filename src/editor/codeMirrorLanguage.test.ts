import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { diagramTypes } from '../state';
import {
    getCodeMirrorSupport,
    getSupportedDiagramTypes,
    toCodeMirrorDiagnostics,
} from './codeMirrorLanguage';

describe('CodeMirror diagram-language support', () => {
    it('covers every diagram language with highlighting and completion data', () => {
        const supported = getSupportedDiagramTypes();
        expect(supported.sort()).toEqual(Object.keys(diagramTypes).sort());

        supported.forEach((diagramType) => {
            const support = getCodeMirrorSupport(diagramType);
            expect(support.extensions.length, `${diagramType} extensions`).toBeGreaterThan(0);
            expect(support.completions.length, `${diagramType} completions`).toBeGreaterThan(0);
        });
    });

    it('converts language diagnostics to CodeMirror document positions', () => {
        const state = EditorState.create({ doc: 'first\nsecond line\nthird' });
        expect(toCodeMirrorDiagnostics(state, [{
            message: 'bad token',
            startLineNumber: 2,
            startColumn: 3,
            endLineNumber: 2,
            endColumn: 9,
            severity: 'error',
        }])).toEqual([{
            from: 8,
            to: 14,
            message: 'bad token',
            severity: 'error',
        }]);
    });
});
