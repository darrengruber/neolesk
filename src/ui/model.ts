/**
 * Pure presentation model for the editor shell: layout classes, zoom maths,
 * list grouping, and every user-visible phrase that more than one view uses.
 * No DOM here, so the rules stay cheap to pin in unit tests.
 */
import type { ExportFormat } from '../export/export';
import type { DiagramTypeMap, ExampleRecord } from '../types';
import { getExampleCacheFilename } from '../examples/cacheKey';
import { filterExamples } from '../utils/examples';

export type LayoutClass = 'compact' | 'regular' | 'wide';
export type Panel = 'code' | 'preview' | 'examples' | 'settings';
export type Presence = 'offline' | 'connected' | 'disconnected';

/** iPad portrait is the first regular width; the full workspace needs room for three columns. */
export const REGULAR_MIN_WIDTH = 768;
export const WIDE_MIN_WIDTH = 1100;

export const layoutForWidth = (width: number): LayoutClass => {
    if (width < REGULAR_MIN_WIDTH) return 'compact';
    if (width < WIDE_MIN_WIDTH) return 'regular';
    return 'wide';
};

export type TabIcon = 'code' | 'preview' | 'editor' | 'examples' | 'settings';

export interface TabDefinition {
    id: Panel;
    label: string;
    icon: TabIcon;
    /** The participant panels that select this tab. */
    panels: Panel[];
}

const compactTabs: TabDefinition[] = [
    { id: 'code', label: 'Code', icon: 'code', panels: ['code'] },
    { id: 'preview', label: 'Preview', icon: 'preview', panels: ['preview'] },
    { id: 'examples', label: 'Examples', icon: 'examples', panels: ['examples'] },
    { id: 'settings', label: 'Settings', icon: 'settings', panels: ['settings'] },
];

const regularTabs: TabDefinition[] = [
    { id: 'code', label: 'Editor', icon: 'editor', panels: ['code', 'preview'] },
    { id: 'examples', label: 'Examples', icon: 'examples', panels: ['examples'] },
    { id: 'settings', label: 'Settings', icon: 'settings', panels: ['settings'] },
];

export const tabsForLayout = (layout: Exclude<LayoutClass, 'wide'>): TabDefinition[] => (
    layout === 'compact' ? compactTabs : regularTabs
);

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** Move one quarter step, snapping an off-grid (pinched) value to the next grid line. */
export const stepZoom = (zoom: number, direction: 1 | -1): number => {
    const steps = zoom / ZOOM_STEP;
    const snapped = direction > 0 ? Math.floor(steps + 1e-9) + 1 : Math.ceil(steps - 1e-9) - 1;
    return clampZoom(snapped * ZOOM_STEP);
};

export const pinchZoom = (startZoom: number, startDistance: number, distance: number): number => (
    startDistance > 0 ? clampZoom(startZoom * (distance / startDistance)) : startZoom
);

export const formatZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`;
export const zoomValueText = (zoom: number): string => `${Math.round(zoom * 100)} percent`;

export interface ExampleGroup {
    id: string;
    name: string;
    examples: ExampleRecord[];
}

const languageName = (diagramTypes: DiagramTypeMap, id: string): string => diagramTypes[id]?.name || id;
const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name, 'en');

export const groupExamples = (
    examples: ExampleRecord[],
    query: string,
    diagramTypes: DiagramTypeMap,
): ExampleGroup[] => {
    // The language name is part of what a person searches for, even when an
    // example's own title does not repeat it.
    const searchable = examples.map((example) => ({
        ...example,
        searchField: `${example.searchField} ${languageName(diagramTypes, example.diagramType).toLowerCase()}`,
    }));
    const matches = new Set(filterExamples(searchable, query).map((example) => example.id));
    const groups = new Map<string, ExampleGroup>();
    for (const example of examples) {
        if (!matches.has(example.id)) continue;
        const group = groups.get(example.diagramType) || {
            id: example.diagramType,
            name: languageName(diagramTypes, example.diagramType),
            examples: [],
        };
        group.examples.push(example);
        groups.set(example.diagramType, group);
    }
    return Array.from(groups.values()).sort(byName);
};

/**
 * The pre-rendered thumbnail of an example, from the site root so that a
 * session path (/s/<id>) does not change it. A build without the thumbnail
 * (NEOLESK_CACHE_SKIP=1) gets null, and the view shows a placeholder instead
 * of requesting a file that is not there.
 */
export const thumbnailUrl = (
    example: ExampleRecord,
    isAvailable: (filename: string) => boolean,
): string | null => {
    const filename = getExampleCacheFilename(example);
    return isAvailable(filename) ? `/cache/${filename}` : null;
};

export interface LanguageSummary {
    id: string;
    name: string;
    count: number;
}

/** The Examples root list: the current language first, then the rest by name. */
export const languageSummaries = (
    examples: ExampleRecord[],
    diagramTypes: DiagramTypeMap,
    currentLanguage: string,
): { current: LanguageSummary | null; others: LanguageSummary[] } => {
    const summaries = groupExamples(examples, '', diagramTypes)
        .map((group) => ({ id: group.id, name: group.name, count: group.examples.length }));
    return {
        current: summaries.find((summary) => summary.id === currentLanguage) || null,
        others: summaries.filter((summary) => summary.id !== currentLanguage),
    };
};

export interface LanguageOption {
    id: string;
    name: string;
}

export interface LanguageSection {
    id: 'local' | 'remote';
    title: string;
    languages: LanguageOption[];
}

export const filterLanguages = (
    diagramTypes: DiagramTypeMap,
    query: string,
    isLocal: (id: string) => boolean,
): LanguageSection[] => {
    const needle = query.trim().toLowerCase();
    const languages = Object.entries(diagramTypes)
        .map(([id, definition]) => ({ id, name: definition.name }))
        .filter((language) => !needle
            || language.name.toLowerCase().includes(needle)
            || language.id.toLowerCase().includes(needle))
        .sort(byName);
    const sections: LanguageSection[] = [
        { id: 'local', title: 'On This Device', languages: languages.filter((language) => isLocal(language.id)) },
        { id: 'remote', title: 'Needs a Render Server', languages: languages.filter((language) => !isLocal(language.id)) },
    ];
    return sections.filter((section) => section.languages.length > 0);
};

export const presenceText = (actor: 'person' | 'agent', presence: Presence): string => {
    if (actor === 'agent') return presence === 'connected' ? 'Agent connected' : 'Agent offline';
    if (presence === 'connected') return 'Connected';
    return presence === 'disconnected' ? 'Reconnecting' : 'Offline';
};

/** The host a person recognises; a malformed URL is shown as written rather than crashing. */
export const hostOf = (url: string): string => {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
};

/**
 * Why a file export row is disabled, or null when it is available. SVG comes
 * from the preview, and this device makes PNG, JPEG and PDF from it when it
 * can draw it (ADR 0021). Otherwise the render server makes only the formats
 * in the language's metadata (`getDiagramFiletypes`) and answers any other
 * with HTTP 400.
 */
export const exportFormatNote = (
    format: ExportFormat,
    hasRenderServer: boolean,
    language: { name: string; formats: readonly string[] } = { name: '', formats: [format] },
    madeOnDevice = false,
): string | null => {
    if (format === 'svg' || madeOnDevice) return null;
    if (!hasRenderServer) return 'Needs a render server';
    return language.formats.includes(format) ? null : `Not available for ${language.name}`;
};
