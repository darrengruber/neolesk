export type BrowserRendererInput = {
    source: string;
    format: 'svg' | string;
    options: Record<string, string>;
};

export type BrowserRenderer = {
    id: string;
    supportedFormats: string[];
    render: (input: Partial<BrowserRendererInput>) => Promise<string>;
};

export class UnsupportedFormatError extends Error {
    constructor(rendererId: string, format: string, supportedFormats: string[]) {
        super(`${rendererId} only supports ${supportedFormats.join(', ')} output, received: ${format}`);
        this.name = 'UnsupportedFormatError';
    }
}

export function assertSupportedFormat(rendererId: string, format: string, supportedFormats: string[]): void {
    if (!supportedFormats.includes(format)) {
        throw new UnsupportedFormatError(rendererId, format, supportedFormats);
    }
}

export function createRenderer({
    id,
    supportedFormats,
    render,
}: {
    id: string;
    supportedFormats: string[];
    render: BrowserRenderer['render'];
}): BrowserRenderer {
    return { id, supportedFormats: [...supportedFormats], render };
}
