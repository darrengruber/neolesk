export type SyntaxTokenAction = string | { token: string; next?: string };

/** Small tokenizer grammar consumed by neolesk's CodeMirror stream adapter. */
export interface MonarchLanguage {
    tokenizer: Record<string, Array<[RegExp, SyntaxTokenAction]>>;
}

export interface LanguageConfiguration {
    comments?: { lineComment?: string; blockComment?: [string, string] };
    autoClosingPairs?: Array<{ open: string; close: string }>;
    surroundingPairs?: Array<{ open: string; close: string }>;
}

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
    languageId: string;
    tokenizer?: MonarchLanguage;
    configuration?: LanguageConfiguration;
    aliases?: string[];
    validate?: DiagramValidator;
}
