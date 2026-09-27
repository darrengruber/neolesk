import { createRenderer, assertSupportedFormat } from './contract';

type MermaidConfig = Record<string, unknown>;

const defaultMermaidConfig: MermaidConfig = {
    theme: 'default',
    class: { useMaxWidth: false },
    er: { useMaxWidth: false },
    flowchart: { useMaxWidth: false },
    // Gantt lays itself out to its container, and the render container is
    // 1px wide, so without a width every bar had a negative width. 584 is the
    // width Kroki gives the same chart, so local and server renders agree.
    gantt: { useMaxWidth: false, useWidth: 584 },
    git: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    state: { useMaxWidth: false },
};

const filteredKeys = new Set(['maxTextSize', 'securityLevel', 'secure', 'startOnLoad']);

function convertPropertyToCamelCase(property: string): string {
    const parts = property.split('_');
    for (let i = 0; i < parts.length; i++) {
        const subParts = parts[i].split('-');
        if (subParts.length > 1) {
            for (let j = 1; j < subParts.length; j++) {
                subParts[j] = subParts[j].charAt(0).toUpperCase() + subParts[j].slice(1);
            }
            parts[i] = subParts.join('');
        }
    }
    return parts.join('.');
}

function getTypedValue(value: string): unknown {
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        return value === 'true';
    }
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',').map(item => getTypedValue(item.trim()));
    }
    if (!Number.isNaN(Number(value))) {
        return Number(value);
    }
    return value;
}

function setNestedProperty(target: MermaidConfig, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: MermaidConfig = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (typeof current[part] !== 'object' || current[part] === null || Array.isArray(current[part])) {
            current[part] = {};
        }
        current = current[part] as MermaidConfig;
    }
    current[parts[parts.length - 1]] = value;
}

function createMermaidConfig(options: Record<string, string>): MermaidConfig {
    const config = JSON.parse(JSON.stringify(defaultMermaidConfig)) as MermaidConfig;
    for (const [property, rawValue] of Object.entries(options)) {
        const camelCase = convertPropertyToCamelCase(property);
        if (filteredKeys.has(camelCase)) continue;
        setNestedProperty(config, camelCase, getTypedValue(rawValue));
    }
    return config;
}

function normalizeSvg(svg: string): string {
    return svg
        .replace(/<br>/g, '<br/>')
        .replace(/<img([^>]*)>/g, (_m: string, g: string) => `<img ${g} />`);
}

let renderCounter = 0;
let renderChain = Promise.resolve('');

export async function load() {
    const mermaid = (await import('mermaid')).default;

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '1px';
    container.style.height = '1px';
    container.style.visibility = 'hidden';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);

    return createRenderer({
        id: 'mermaid',
        supportedFormats: ['svg'],
        render: async ({ source = '', format = 'svg', options = {} } = {}) => {
            assertSupportedFormat('mermaid', format, ['svg']);
            if (source === '') return '';

            // Serialize renders — mermaid uses global state
            const result = renderChain.then(async () => {
                const config = createMermaidConfig(options as Record<string, string>);
                mermaid.initialize({
                    ...config,
                    startOnLoad: false,
                    securityLevel: 'strict',
                    maxTextSize: 50000,
                });

                container.innerHTML = '';
                const id = `neolesk-mermaid-${renderCounter++}`;
                const { svg } = await mermaid.render(id, source, container);
                return normalizeSvg(svg);
            });

            renderChain = result.catch(() => '');
            return result;
        },
    });
}

let exportRenderer: ReturnType<typeof load> | null = null;

/**
 * The same diagram with labels as SVG text instead of HTML. A canvas cannot
 * export HTML labels (ADR 0021). mermaid.initialize resets the whole config on
 * each render, so the preview keeps its HTML labels.
 */
export async function renderPlainLabels(source: string): Promise<string> {
    exportRenderer ||= load();
    return (await exportRenderer).render({
        source,
        format: 'svg',
        options: { 'html-labels': 'false', 'flowchart_html-labels': 'false' },
    });
}
