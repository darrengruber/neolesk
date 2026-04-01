import type * as monacoEditor from 'monaco-editor';

export type MonarchLanguage = monacoEditor.languages.IMonarchLanguage;
export type LanguageConfiguration = monacoEditor.languages.LanguageConfiguration;

export interface DiagramValidationMarker {
    message: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    severity: 'error' | 'warning';
}

export interface DiagramValidationContext {
    diagramType: string;
    text: string;
}

export type DiagramValidator = (context: DiagramValidationContext) => DiagramValidationMarker[];

export interface DiagramLanguageDefinition {
    diagramType: string;
    monacoLanguageId: string;
    tokenizer?: MonarchLanguage;
    configuration?: LanguageConfiguration;
    aliases?: string[];
    validate?: DiagramValidator;
}
