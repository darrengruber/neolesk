import examples from './examples';
import { decode, encode } from './kroki/coder';
import krokiInfo from './kroki/krokiInfo';
import { defaultFiletype } from './kroki/metadata';
import type { DiagramState, DiagramStateInput, DiagramTypeMap, ParsedDiagramUrl } from './types';

export const defaultDiagramType = 'plantuml';
export const defaultRenderUrl = 'https://kroki.io/';

export const diagramTypes = krokiInfo as DiagramTypeMap;

const createKrokiUrl = (renderUrl: string, diagramType: string, filetype: string, encodedText: string): string =>
    [renderUrl.replace(/\/*$/, ''), diagramType, filetype, encodedText].join('/');

export const createDiagramHash = (diagramType: string, filetype: string, encodedText: string): string =>
    [diagramType, filetype, encodedText].join('/');

export const normalizeRenderUrl = (renderUrl?: string | null): string => {
    if (!renderUrl || renderUrl === '' || renderUrl === defaultRenderUrl || renderUrl === defaultRenderUrl.slice(0, -1)) {
        return defaultRenderUrl;
    }

    return renderUrl.endsWith('/') ? renderUrl : `${renderUrl}/`;
};

const clientExportFormats = new Set(['svg', 'png', 'jpeg', 'pdf']);

export const getValidFiletype = (_diagramType: string, filetype?: string | null): string => {
    if (filetype && clientExportFormats.has(filetype)) {
        return filetype;
    }

    return defaultFiletype;
};

const isDefaultDiagram = (diagramType: string, diagramText: string): boolean => {
    const encodedDiagram = encode(diagramText);
    return examples.some((example) => example.diagramType === diagramType && example.example === encodedDiagram);
};

export const buildDiagramState = (input: DiagramStateInput): DiagramState => {
    const normalizedRenderUrl = normalizeRenderUrl(input.renderUrl);
    const filetype = getValidFiletype(input.diagramType, input.filetype);
    const language = diagramTypes[input.diagramType]?.language || null;
    const encodedDiagramText = encode(input.diagramText);
    const svgUrl = createKrokiUrl(normalizedRenderUrl, input.diagramType, 'svg', encodedDiagramText);
    const exportUrl = createKrokiUrl(normalizedRenderUrl, input.diagramType, filetype, encodedDiagramText);
    const diagramHash = createDiagramHash(input.diagramType, filetype, encodedDiagramText);

    return {
        ...input,
        filetype,
        renderUrl: normalizedRenderUrl,
        language,
        defaultDiagram: isDefaultDiagram(input.diagramType, input.diagramText),
        svgUrl,
        exportUrl,
        diagramHash,
        editUrl: `${input.baseUrl}#${diagramHash}`,
    };
};

export const createInitialDiagramState = (baseUrl: string): DiagramState => {
    const diagramType = defaultDiagramType;
    const diagramText = decode(diagramTypes[diagramType].example);
    const filetype = getValidFiletype(diagramType, defaultFiletype);
    const renderUrl = defaultRenderUrl;

    return buildDiagramState({
        baseUrl,
        diagramType,
        diagramText,
        filetype,
        renderUrl,
    });
};

export const parseDiagramUrl = (input: string): ParsedDiagramUrl | null => {
    if (!input) {
        return null;
    }

    let url = input.startsWith('#') ? input.slice(1) : input;

    const protocolSeparator = '://';
    const protocolSeparatorPosition = url.indexOf(protocolSeparator);

    if (protocolSeparatorPosition >= 0) {
        url = url.slice(protocolSeparatorPosition + protocolSeparator.length);
        const urlParts = url.split('/');

        if (urlParts.length < 4) {
            return null;
        }

        const encodedText = urlParts[urlParts.length - 1];
        const filetype = urlParts[urlParts.length - 2];
        const diagramType = urlParts[urlParts.length - 3];

        if (!diagramType || !encodedText) {
            return null;
        }

        return {
            diagramType,
            filetype: getValidFiletype(diagramType, filetype),
            diagramText: decode(encodedText),
        };
    }

    const parts = url.split('/');

    if (parts.length < 3) {
        return null;
    }

    const [diagramType, filetype, ...rest] = parts;
    const encodedText = rest.join('/');

    if (!diagramType || !encodedText) {
        return null;
    }

    return {
        diagramType,
        filetype: getValidFiletype(diagramType, filetype),
        diagramText: decode(encodedText),
    };
};
