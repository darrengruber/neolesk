export interface ExampleDefinition {
    diagramType: string;
    default: boolean;
    description: string;
    title: string;
    example: string;
    doc?: string;
    keywords?: string[];
    language?: string | null;
}

export interface ExampleRecord extends ExampleDefinition {
    id: number;
    searchField: string;
    url: string;
}

export interface DiagramTypeDefinition {
    name: string;
    example: string;
    language: string | null;
    filetypes: string[];
}

export type DiagramTypeMap = Record<string, DiagramTypeDefinition>;

export type LayoutMode = 'vertical' | 'horizontal' | 'preview';
export type MobileTab = 'code' | 'preview';
export type CopyScope = 'image' | 'edit' | 'markdown' | 'markdownsource';

export interface RuntimeConfig {
    krokiEngineUrl: string;
}

export interface DiagramStateInput {
    baseUrl: string;
    diagramType: string;
    filetype: string;
    renderUrl: string;
    diagramText: string;
}

export interface DiagramState extends DiagramStateInput {
    language: string | null;
    defaultDiagram: boolean;
    diagramUrl: string;
    diagramEditUrl: string;
}

export interface ParsedDiagramUrl {
    diagramType: string;
    filetype: string;
    renderUrl: string;
    diagramText: string;
}
