import type * as monacoEditor from 'monaco-editor';
import cheatSheets from '../data/cheatSheets';
import examples from '../examples';
import { decode } from '../kroki/coder';
import diagramLanguageDefinitions from './languages';
import type { DiagramValidationMarker } from './languages/types';

type Monaco = typeof monacoEditor;
type CompletionItem = monacoEditor.languages.CompletionItem;
type CompletionSeed = Omit<CompletionItem, 'range'>;

const definitionsByDiagramType = diagramLanguageDefinitions.reduce<Record<string, (typeof diagramLanguageDefinitions)[number]>>((result, definition) => {
    result[definition.diagramType] = definition;
    return result;
}, {});

const allSupportedDiagramTypes = Array.from(new Set([
    ...Object.keys(cheatSheets),
    ...diagramLanguageDefinitions.map((definition) => definition.diagramType),
]));

const exampleTextByDiagramType = examples.reduce<Record<string, string>>((result, example) => {
    if (example.default && !result[example.diagramType]) {
        result[example.diagramType] = decode(example.example);
    }
    return result;
}, {});

const getCompletionItems = (monaco: Monaco, diagramType: string): CompletionSeed[] => {
    const cheatSheet = cheatSheets[diagramType];
    const summary = cheatSheet?.summary || 'Diagram syntax snippet';
    const suggestions: CompletionSeed[] = [];
    let sortIndex = 0;

    const defaultExample = exampleTextByDiagramType[diagramType];
    if (defaultExample) {
        suggestions.push({
            label: `${diagramType} example`,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: defaultExample,
            detail: 'Default example',
            documentation: summary,
            sortText: `0-${String(sortIndex++).padStart(2, '0')}`,
        });
    }

    cheatSheet?.sections.forEach((section) => {
        suggestions.push({
            label: `${diagramType}: ${section.heading}`,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: section.items.join('\n'),
            detail: section.heading,
            documentation: `${summary}\n\n${section.heading}`,
            sortText: `1-${String(sortIndex++).padStart(2, '0')}`,
        });
    });

    return suggestions;
};

export const getEditorLanguageId = (diagramType: string, fallbackLanguage?: string | null): string => (
    definitionsByDiagramType[diagramType]?.monacoLanguageId
    || fallbackLanguage
    || 'plaintext'
);

export const getEditorModelPath = (diagramType: string): string => `inmemory://neolesk/${diagramType}.diagram`;

export const getSupportedDiagramTypes = (): string[] => [...allSupportedDiagramTypes];

export const getCompletionCountByDiagramType = (): Record<string, number> => allSupportedDiagramTypes.reduce<Record<string, number>>((result, diagramType) => {
    result[diagramType] = (cheatSheets[diagramType]?.sections.length || 0) + (exampleTextByDiagramType[diagramType] ? 1 : 0);
    return result;
}, {});

export const validateDiagramText = (diagramType: string, text: string): DiagramValidationMarker[] => (
    definitionsByDiagramType[diagramType]?.validate?.({ diagramType, text }) || []
);

const diagramTypeFromModelPath = (path: string): string | null => {
    const match = path.match(/\/([^/]+)\.diagram$/);
    return match ? match[1] : null;
};

const registerCompletionProvider = (monaco: Monaco, languageId: string) => {
    monaco.languages.registerCompletionItemProvider(languageId, {
        provideCompletionItems(model, position) {
            const diagramType = diagramTypeFromModelPath(model.uri.path);
            if (!diagramType) {
                return { suggestions: [] };
            }

            const suggestions = getCompletionItems(monaco, diagramType).map((item) => {
                const word = model.getWordUntilPosition(position);
                return {
                    ...item,
                    range: {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn,
                    },
                };
            });

            return { suggestions };
        },
    });
};

export const configureDiagramLanguages = (monaco: Monaco): void => {
    const globalMonacoState = globalThis as typeof globalThis & { __neoleskMonacoConfigured?: boolean };
    if (globalMonacoState.__neoleskMonacoConfigured) {
        return;
    }

    globalMonacoState.__neoleskMonacoConfigured = true;

    const completionProviders = new Set<string>();

    diagramLanguageDefinitions.forEach((definition) => {
        if (definition.tokenizer) {
            monaco.languages.register({
                id: definition.monacoLanguageId,
                aliases: definition.aliases || [definition.diagramType],
            });
            monaco.languages.setMonarchTokensProvider(definition.monacoLanguageId, definition.tokenizer);
            monaco.languages.setLanguageConfiguration(definition.monacoLanguageId, definition.configuration || {});
        }

        if (!completionProviders.has(definition.monacoLanguageId)) {
            registerCompletionProvider(monaco, definition.monacoLanguageId);
            completionProviders.add(definition.monacoLanguageId);
        }
    });
};
