import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import type { Diagnostic } from '@codemirror/lint';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { xml } from '@codemirror/legacy-modes/mode/xml';
import cheatSheets from '../data/cheatSheets';
import examples from '../examples';
import { decode } from '../kroki/coder';
import diagramLanguageDefinitions from './languages';
import type { DiagramValidationMarker, MonarchLanguage } from './languages/types';

interface StreamState {
    name: string;
}

type MonarchAction = string | { token: string; next?: string };
type MonarchRule = [RegExp, MonarchAction];

const tokenStyle = (token: string): string | null => {
    if (token === 'white') return null;
    if (token === '@brackets') return 'bracket';
    if (token.startsWith('type')) return 'typeName';
    if (token.startsWith('attribute')) return 'propertyName';
    if (token.startsWith('number')) return 'number';
    if (token === 'identifier') return 'variableName';
    if (token === 'delimiter') return 'punctuation';
    return token;
};

const streamParserFor = (language?: MonarchLanguage): StreamParser<StreamState> => ({
    startState: () => ({ name: 'root' }),
    copyState: (state) => ({ ...state }),
    token(stream: StringStream, state: StreamState) {
        const tokenizer = language?.tokenizer as Record<string, MonarchRule[]> | undefined;
        const rules = tokenizer?.[state.name] || tokenizer?.root || [];
        for (const [pattern, action] of rules) {
            if (!stream.match(pattern)) continue;
            if (typeof action === 'string') return tokenStyle(action);
            if (action.next === '@pop') state.name = 'root';
            else if (action.next?.startsWith('@')) state.name = action.next.slice(1);
            return tokenStyle(action.token);
        }
        stream.next();
        return null;
    },
});

const definitionsByDiagramType = new Map(
    diagramLanguageDefinitions.map((definition) => [definition.diagramType, definition]),
);

const exampleTextByDiagramType = examples.reduce<Record<string, string>>((result, example) => {
    if (example.default && !result[example.diagramType]) result[example.diagramType] = decode(example.example);
    return result;
}, {});

const getCompletions = (diagramType: string): Completion[] => {
    const completions: Completion[] = [];
    const defaultExample = exampleTextByDiagramType[diagramType];
    if (defaultExample) {
        completions.push({
            label: `${diagramType} example`,
            type: 'text',
            detail: 'Default example',
            apply: defaultExample,
            boost: 100,
        });
    }
    cheatSheets[diagramType]?.sections.forEach((section, index) => {
        completions.push({
            label: `${diagramType}: ${section.heading}`,
            type: 'keyword',
            detail: section.heading,
            info: cheatSheets[diagramType].summary,
            apply: section.items.join('\n'),
            boost: 50 - index,
        });
    });
    return completions;
};

const completionSource = (completions: Completion[]) => (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w@!#.-]*/);
    if (!context.explicit && (!word || word.from === word.to)) return null;
    return { from: word?.from ?? context.pos, options: completions };
};

const languageExtension = (diagramType: string): Extension => {
    const definition = definitionsByDiagramType.get(diagramType);
    switch (definition?.languageId) {
        case 'json': return json();
        case 'yaml': return yaml();
        case 'xml': return StreamLanguage.define(xml);
        case 'systemverilog': return StreamLanguage.define(verilog);
        default: return StreamLanguage.define(streamParserFor(definition?.tokenizer));
    }
};

export interface CodeMirrorSupport {
    diagramType: string;
    extensions: Extension[];
    completions: Completion[];
}

export const getCodeMirrorSupport = (diagramType: string): CodeMirrorSupport => {
    const completions = getCompletions(diagramType);
    return {
        diagramType,
        completions,
        extensions: [
            languageExtension(diagramType),
            autocompletion({ override: [completionSource(completions)] }),
        ],
    };
};

export const getSupportedDiagramTypes = (): string[] => Array.from(definitionsByDiagramType.keys());

export const validateDiagramText = (diagramType: string, text: string): DiagramValidationMarker[] => (
    definitionsByDiagramType.get(diagramType)?.validate?.({ diagramType, text }) || []
);

const position = (state: EditorState, lineNumber: number, column: number): number => {
    const line = state.doc.line(Math.min(Math.max(1, lineNumber), state.doc.lines));
    return Math.min(line.to, line.from + Math.max(0, column - 1));
};

export const toCodeMirrorDiagnostics = (
    state: EditorState,
    markers: DiagramValidationMarker[],
): Diagnostic[] => markers.map((marker) => ({
    from: position(state, marker.startLineNumber, marker.startColumn),
    to: position(state, marker.endLineNumber, marker.endColumn),
    message: marker.message,
    severity: marker.severity,
}));
