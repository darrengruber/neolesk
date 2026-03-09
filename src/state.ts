import examples from './examples';
import { decode, encode } from './kroki/coder';
import krokiInfo from './kroki/krokiInfo';
import { defaultFiletype, getDiagramFiletypes } from './kroki/metadata';
import type { DiagramState, DiagramStateInput, DiagramTypeMap, ParsedDiagramUrl } from './types';

export const defaultDiagramType = 'plantuml';
const legacyRenderUrl = 'https://kroki.io/';
export const defaultRenderUrl = 'https://kroki.io/';

export const diagramTypes = krokiInfo as DiagramTypeMap;

const createKrokiUrl = (renderUrl: string, diagramType: string, filetype: string, encodedText: string): string =>
    [renderUrl.replace(/\/*$/, ''), diagramType, filetype, encodedText].join('/');

export const normalizeRenderUrl = (renderUrl?: string | null): string => {
    if (!renderUrl || renderUrl === '' || renderUrl === legacyRenderUrl || renderUrl === legacyRenderUrl.slice(0, -1)) {
        return defaultRenderUrl;
    }

    return renderUrl.endsWith('/') ? renderUrl : `${renderUrl}/`;
};

export const getValidFiletype = (diagramType: string, filetype?: string | null): string => {
    const filetypes = getDiagramFiletypes(diagramType);

    if (filetype && filetypes.includes(filetype)) {
        return filetype;
    }

    return filetypes[0] || defaultFiletype;
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
    const diagramUrl = createKrokiUrl(normalizedRenderUrl, input.diagramType, filetype, encodedDiagramText);

    return {
        ...input,
        filetype,
        renderUrl: normalizedRenderUrl,
        language,
        defaultDiagram: isDefaultDiagram(input.diagramType, input.diagramText),
        diagramUrl,
        diagramEditUrl: `${input.baseUrl}#${diagramUrl}`,
    };
};

export const createInitialDiagramState = (baseUrl: string, hash: string): DiagramState => {
    const parsed = parseDiagramUrl(hash);

    const diagramType = parsed?.diagramType || defaultDiagramType;
    const fallbackExample = diagramTypes[diagramType]?.example || diagramTypes[defaultDiagramType].example;
    const diagramText = parsed?.diagramText || decode(fallbackExample);
    const filetype = parsed?.filetype || getValidFiletype(diagramType, defaultFiletype);
    const renderUrl = parsed?.renderUrl || defaultRenderUrl;

    return buildDiagramState({
        baseUrl,
        diagramType,
        diagramText,
        filetype,
        renderUrl,
    });
};

export const changeDiagramType = (state: DiagramState, nextDiagramType: string): DiagramState => {
    const nextFiletype = getValidFiletype(nextDiagramType, state.filetype);
    const nextText = state.defaultDiagram || state.diagramText === ''
        ? decode(diagramTypes[nextDiagramType].example)
        : state.diagramText;

    return buildDiagramState({
        baseUrl: state.baseUrl,
        diagramType: nextDiagramType,
        diagramText: nextText,
        filetype: nextFiletype,
        renderUrl: state.renderUrl,
    });
};

export const parseDiagramUrl = (input: string): ParsedDiagramUrl | null => {
    if (!input) {
        return null;
    }

    let url = input.startsWith('#') ? input.slice(1) : input;
    const protocolSeparator = '://';
    const protocolSeparatorPosition = url.indexOf(protocolSeparator);

    let protocol: string | null = null;
    if (protocolSeparatorPosition >= 0) {
        protocol = url.slice(0, protocolSeparatorPosition);
        url = url.slice(protocolSeparatorPosition + protocolSeparator.length);
    }

    const urlParts = url.split('/');

    if (urlParts.length < 4) {
        return null;
    }

    const encodedText = urlParts[urlParts.length - 1];
    const filetype = urlParts[urlParts.length - 2];
    const diagramType = urlParts[urlParts.length - 3];
    const renderSite = urlParts.slice(0, -3).join('/');

    if (!protocol || !renderSite || !diagramType || !encodedText) {
        return null;
    }

    return {
        diagramType,
        filetype: getValidFiletype(diagramType, filetype),
        renderUrl: normalizeRenderUrl(`${protocol}${protocolSeparator}${renderSite}`),
        diagramText: decode(encodedText),
    };
};

