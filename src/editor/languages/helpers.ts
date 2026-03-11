import { parseDocument } from 'yaml';
import type {
    DiagramLanguageDefinition,
    DiagramValidationContext,
    DiagramValidationMarker,
    DiagramValidator,
    LanguageConfiguration,
    MonarchLanguage,
} from './types';

const commentBlockTokenizer = (commentStart: RegExp, commentToken = 'comment'): MonarchLanguage => ({
    tokenizer: {
        root: [
            [commentStart, { token: commentToken, next: '@comment' }],
        ],
        comment: [
            [/[^/*]+/, commentToken],
            [/\/\*/, commentToken],
            [/\*\//, { token: commentToken, next: '@pop' }],
            [/[/ *]/, commentToken],
        ],
    },
});

const withBlockComments = (language: MonarchLanguage, commentStart = /\/\*/): MonarchLanguage => ({
    ...language,
    tokenizer: {
        ...language.tokenizer,
        comment: commentBlockTokenizer(commentStart).tokenizer.comment,
        root: [
            [commentStart, { token: 'comment', next: '@comment' }],
            ...(language.tokenizer.root || []),
        ],
    },
});

export const sharedConfiguration: LanguageConfiguration = {
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: '\'', close: '\'' },
    ],
    surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: '\'', close: '\'' },
    ],
};

const familyDefinitions: Record<string, { tokenizer: MonarchLanguage; configuration?: LanguageConfiguration }> = {
    asciiDiagram: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\b(?:c[A-Z]{3}|{[a-z]})\b/, 'keyword'],
                    [/[+\-|/\\.^v<>(){}\[\]]+/, 'operator'],
                    [/"[^"]*"/, 'string'],
                    [/[A-Za-z_][\w-]*/, 'identifier'],
                    [/\d+/, 'number'],
                ],
            },
        },
    },
    bytefield: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/;.*/, 'comment'],
                    [/\(/, '@brackets'],
                    [/\)/, '@brackets'],
                    [/"[^"]*"/, 'string'],
                    [/\b(?:def|draw-box|draw-column-headers|draw-gap|draw-bottom|draw-top|next-row|text|attr|span|box-first|box-last|fill)\b/, 'keyword'],
                    [/:[\w-]+/, 'type.identifier'],
                    [/[A-Za-z_][\w-]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: ';' },
        },
    },
    d2: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/#.*/, 'comment'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:shape|style|label|icon|link|tooltip|direction|near|class|constraint|primary_key|grid-rows|grid-columns|sql_table|true|false|null)\b/, 'keyword'],
                    [/[-=]+>|<[-=]+|<->|--/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.-]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                    [/:/, 'delimiter'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '#' },
        },
    },
    dbml: {
        tokenizer: withBlockComments({
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\/\/.*/, 'comment'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:Table|TableGroup|Ref|Enum|Project|Note|indexes|Index|pk|primary key|increment|not null|null|unique|default|ref|delete|update)\b/, 'keyword'],
                    [/\b(?:smallint|integer|bigint|decimal|numeric|varchar|char|text|timestamp|json|jsonb|boolean|uuid)\b/i, 'type'],
                    [/->|<-|--|<>|>/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                    [/:|,/, 'delimiter'],
                ],
            },
        }),
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        },
    },
    diag: {
        tokenizer: withBlockComments({
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\/\/.*/, 'comment'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:actdiag|blockdiag|nwdiag|packetdiag|rackdiag|seqdiag|network|group|lane|class|colwidth|description|orientation|label|color|shape|style|address|span|note)\b/, 'keyword'],
                    [/->>|-->|->|--/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.-]*/, 'identifier'],
                    [/#(?:[0-9A-Fa-f]{3,8})\b/, 'number.hex'],
                    [/-?\d+(?:\.\d+)?(?:U)?/, 'number'],
                    [/[:;=,]/, 'delimiter'],
                ],
            },
        }),
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        },
    },
    erd: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/#.*/, 'comment'],
                    [/\[[^\]]+\]/, 'type.identifier'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\*--\*|\*--1|1--\*|1--1|\+--\*|\?--1/, 'operator'],
                    [/\b(?:title|header|entity|relationship|bgcolor|size)\b/, 'keyword'],
                    [/\b(?:\*|\+|\?|1)\b/, 'keyword'],
                    [/[{}():,]/, 'delimiter'],
                    [/[A-Za-z_][\w-]*/, 'identifier'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '#' },
        },
    },
    graphviz: {
        tokenizer: withBlockComments({
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\/\/.*/, 'comment'],
                    [/#.*/, 'comment'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:strict|graph|digraph|subgraph|node|edge)\b/, 'keyword'],
                    [/\b(?:rankdir|label|shape|style|color|fillcolor|bgcolor|fontname|fontsize|penwidth|arrowhead|arrowtail|splines|compound|rank)\b/, 'attribute.name'],
                    [/->|--/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                    [/[,;=:]/, 'delimiter'],
                ],
            },
        }),
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        },
    },
    mermaid: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/%%.*/, 'comment'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|xychart-beta|block-beta|architecture-beta|subgraph|direction|participant|actor|loop|alt|opt|par|and|else|end|section|title|class|state|note)\b/, 'keyword'],
                    [/\b(?:TB|TD|BT|LR|RL)\b/, 'keyword'],
                    [/-{1,2}\.?-?>|==>|===|<-->|<==>|o--o|o--|--o|\|\|--o\{|\|\|--\|\||\}o--o\{/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.-]*/, 'identifier'],
                    [/:|,/, 'delimiter'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '%%' },
        },
    },
    nomnoml: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/^\s*\/\/.*$/, 'comment'],
                    [/^\s*#(?:direction|fill|stroke|font|fontSize|lineWidth|arrowSize|bendSize|spacing|padding|title|zoom|gravity|edges|acyclicer|ranker):.*$/, 'keyword'],
                    [/^\s*#\.[A-Za-z_][\w-]*:.*$/, 'keyword'],
                    [/\[/, { token: '@brackets', next: '@nomnomlClassifier' }],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/<:--|--:>|-:>|<:-|o->|<->|-->|<--|->|--|-\/>|<\/-|:>|<:|o-|[+o]?-[+o]?/, 'operator'],
                    [/\b\d+\.\.\d+\b|\b\d+\b|\*/, 'number'],
                    [/[|;]/, 'delimiter'],
                    [/[A-Za-z_][\w-]*/, 'identifier'],
                ],
                nomnomlClassifier: [
                    [/\]/, { token: '@brackets', next: '@pop' }],
                    [/<[A-Za-z_][\w-]*>/, 'keyword'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/<:--|--:>|-:>|<:-|o->|<->|-->|<--|->|--|-\/>|<\/-|:>|<:|o-|[+o]?-[+o]?/, 'operator'],
                    [/\b\d+\.\.\d+\b|\b\d+\b|\*/, 'number'],
                    [/[|;]/, 'delimiter'],
                    [/[A-Za-z_][\w-]*/, 'identifier'],
                    [/[^\]|;<>"]+/, 'type.identifier'],
                ],
            },
        },
        configuration: sharedConfiguration,
    },
    pikchr: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/#.*/, 'comment'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:box|circle|ellipse|oval|cylinder|file|dot|text|line|arrow|move|left|right|up|down|from|to|at|with|same|as|then|color|fill|thick|thin|dashed|invis)\b/, 'keyword'],
                    [/->|<-|--/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.-]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?(?:cm|in|px)?/, 'number'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '#' },
        },
    },
    plantuml: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/'.*/, 'comment'],
                    [/![-A-Za-z_][\w<>/-]*/, 'keyword'],
                    [/@[-A-Za-z_][\w-]*/, 'keyword'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:participant|actor|boundary|control|entity|database|collections|queue|class|interface|enum|annotation|abstract|object|map|rectangle|package|component|node|cloud|frame|folder|artifact|agent|card|file|storage|start|stop|end|endif|while|endwhile|repeat|fork|if|then|else|endif|note|skinparam|title|caption|legend|footer|header|Person|Person_Ext|System|System_Ext|Container|ContainerDb|Component|Rel|Rel_U|Rel_D|Rel_L|Rel_R|LAYOUT_WITH_LEGEND|LAYOUT_TOP_DOWN|LAYOUT_LEFT_RIGHT)\b/, 'keyword'],
                    [/#(?:[0-9A-Fa-f]{3,8}|[A-Za-z]+)\b/, 'number.hex'],
                    [/<\|--|\*--|o--|-->|->>|<--|<\.\.|\.{2}>|==>|<==|-->>|<-->/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.:$-]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                    [/[:,;]/, 'delimiter'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '\'' },
        },
    },
    structurizr: {
        tokenizer: withBlockComments({
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\/\/.*/, 'comment'],
                    [/![A-Za-z_][\w-]*/, 'keyword'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\b(?:workspace|model|views|styles|theme|themes|branding|person|softwareSystem|container|component|deploymentEnvironment|deploymentNode|infrastructureNode|systemLandscape|systemContext|containerView|componentView|dynamicView|deploymentView|filtered|include|exclude|autoLayout|relationship|tags)\b/, 'keyword'],
                    [/->|<-/, 'operator'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w.-]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?/, 'number'],
                ],
            },
        }),
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        },
    },
    tikz: {
        tokenizer: {
            tokenizer: {
                root: [
                    [/[ \t\r\n]+/, 'white'],
                    [/%.*$/, 'comment'],
                    [/\\[A-Za-z@]+/, 'keyword'],
                    [/"([^"\\]|\\.)*"/, 'string'],
                    [/\[[^\]]*\]/, 'attribute.value'],
                    [/[{}()[\]]/, '@brackets'],
                    [/[A-Za-z_][\w-]*/, 'identifier'],
                    [/-?\d+(?:\.\d+)?(?:cm|mm|pt|em|ex)?/, 'number'],
                    [/[,;:]/, 'delimiter'],
                ],
            },
        },
        configuration: {
            ...sharedConfiguration,
            comments: { lineComment: '%' },
        },
    },
};

const createMarker = (
    message: string,
    line = 1,
    column = 1,
    endLine = line,
    endColumn = column + 1,
    severity: DiagramValidationMarker['severity'] = 'error',
): DiagramValidationMarker => ({
    message,
    startLineNumber: line,
    startColumn: column,
    endLineNumber: endLine,
    endColumn,
    severity,
});

const offsetToPosition = (text: string, offset: number): { line: number; column: number } => {
    let line = 1;
    let column = 1;
    for (let index = 0; index < Math.min(offset, text.length); index += 1) {
        if (text[index] === '\n') {
            line += 1;
            column = 1;
        } else {
            column += 1;
        }
    }
    return { line, column };
};

const getFirstMeaningfulLine = (text: string, commentPrefixes: string[] = []): { line: number; value: string } | null => {
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const value = lines[index].trim();
        if (!value) {
            continue;
        }
        if (commentPrefixes.some((prefix) => value.startsWith(prefix))) {
            continue;
        }
        return { line: index + 1, value };
    }
    return null;
};

const buildBalancedPairValidator = (
    pair: { open: string; close: string },
    options?: { lineCommentPrefixes?: string[] },
): DiagramValidator => ({ text }) => {
    const stack: Array<{ line: number; column: number }> = [];
    let line = 1;
    let column = 1;
    let inDoubleQuote = false;
    let inSingleQuote = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text.slice(index);

        if (!inSingleQuote && !inDoubleQuote && options?.lineCommentPrefixes?.some((prefix) => next.startsWith(prefix))) {
            while (index < text.length && text[index] !== '\n') {
                index += 1;
            }
            line += 1;
            column = 1;
            continue;
        }

        if (char === '\n') {
            line += 1;
            column = 1;
            continue;
        }

        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
        } else if (char === '\'' && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
        }

        if (!inSingleQuote && !inDoubleQuote) {
            if (char === pair.open) {
                stack.push({ line, column });
            } else if (char === pair.close) {
                const last = stack.pop();
                if (!last) {
                    return [createMarker(`Unexpected '${pair.close}'`, line, column)];
                }
            }
        }

        column += 1;
    }

    const last = stack.pop();
    return last ? [createMarker(`Missing closing '${pair.close}'`, last.line, last.column)] : [];
};

const buildFirstLineValidator = (
    matcher: RegExp,
    message: string,
    commentPrefixes: string[] = [],
): DiagramValidator => ({ text }) => {
    const firstLine = getFirstMeaningfulLine(text, commentPrefixes);
    if (!firstLine || matcher.test(firstLine.value)) {
        return [];
    }

    return [createMarker(message, firstLine.line, 1, firstLine.line, firstLine.value.length + 1)];
};

const buildPairedKeywordValidator = (startKeyword: string, endKeyword: string): DiagramValidator => ({ text }) => {
    const hasStart = text.includes(startKeyword);
    const hasEnd = text.includes(endKeyword);

    if (hasStart && !hasEnd) {
        const line = text.split('\n').findIndex((value) => value.includes(startKeyword)) + 1;
        return [createMarker(`Missing '${endKeyword}'`, line || 1, 1)];
    }

    if (!hasStart && hasEnd) {
        const line = text.split('\n').findIndex((value) => value.includes(endKeyword)) + 1;
        return [createMarker(`Unexpected '${endKeyword}' without '${startKeyword}'`, line || 1, 1)];
    }

    return [];
};

export const combineValidators = (...validators: Array<DiagramValidator | undefined>): DiagramValidator => (context: DiagramValidationContext) => (
    validators.flatMap((validator) => validator ? validator(context) : [])
);

export const jsonValidator: DiagramValidator = ({ text }) => {
    try {
        JSON.parse(text);
        return [];
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid JSON';
        const match = message.match(/position\s+(\d+)/i);
        if (match) {
            const { line, column } = offsetToPosition(text, Number(match[1]));
            return [createMarker(message, line, column)];
        }
        return [createMarker(message)];
    }
};

export const xmlValidator: DiagramValidator = ({ text }) => {
    const parser = new DOMParser();
    const document = parser.parseFromString(text, 'application/xml');
    const parserError = document.querySelector('parsererror');
    if (!parserError) {
        return [];
    }

    const message = parserError.textContent?.trim() || 'Invalid XML';
    const positionMatch = message.match(/line\s+(\d+)[^\d]+column\s+(\d+)/i);
    if (positionMatch) {
        return [createMarker(message, Number(positionMatch[1]), Number(positionMatch[2]))];
    }

    return [createMarker(message)];
};

export const yamlValidator: DiagramValidator = ({ text }) => {
    const document = parseDocument(text, { prettyErrors: false, strict: true, uniqueKeys: true });
    if (document.errors.length === 0) {
        return [];
    }

    return document.errors.map((error) => {
        const start = error.linePos?.[0];
        const end = error.linePos?.[1];
        return createMarker(
            error.message,
            start?.line || 1,
            start?.col || 1,
            end?.line || start?.line || 1,
            end?.col || (start?.col || 1) + 1,
        );
    });
};

export const buildCurlyBraceValidator = (lineCommentPrefixes?: string[]): DiagramValidator => (
    buildBalancedPairValidator({ open: '{', close: '}' }, { lineCommentPrefixes })
);

export const buildParenthesisValidator = (lineCommentPrefixes?: string[]): DiagramValidator => (
    buildBalancedPairValidator({ open: '(', close: ')' }, { lineCommentPrefixes })
);

export const buildSquareBracketValidator = (lineCommentPrefixes?: string[]): DiagramValidator => (
    buildBalancedPairValidator({ open: '[', close: ']' }, { lineCommentPrefixes })
);

export const buildFirstLineRegexValidator = (
    matcher: RegExp,
    message: string,
    commentPrefixes?: string[],
): DiagramValidator => buildFirstLineValidator(matcher, message, commentPrefixes);

export const buildFenceValidator = (startKeyword: string, endKeyword: string): DiagramValidator => (
    buildPairedKeywordValidator(startKeyword, endKeyword)
);

export const defineDiagramLanguage = (
    diagramType: string,
    monacoLanguageId: string,
    options?: Pick<DiagramLanguageDefinition, 'tokenizer' | 'configuration' | 'aliases' | 'validate'>,
): DiagramLanguageDefinition => ({
    diagramType,
    monacoLanguageId,
    aliases: options?.aliases || [diagramType],
    tokenizer: options?.tokenizer,
    configuration: options?.configuration,
    validate: options?.validate,
});

export const defineBuiltinDiagramLanguage = (
    diagramType: string,
    monacoLanguageId: string,
    validate?: DiagramValidator,
): DiagramLanguageDefinition => (
    defineDiagramLanguage(diagramType, monacoLanguageId, { validate })
);

export const defineFamilyDiagramLanguage = (
    diagramType: string,
    family: keyof typeof familyDefinitions,
    validate?: DiagramValidator,
): DiagramLanguageDefinition => {
    const definition = familyDefinitions[family];
    return defineDiagramLanguage(diagramType, `neolesk-${diagramType}`, { ...definition, validate });
};
