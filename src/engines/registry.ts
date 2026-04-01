import type { BrowserRenderer } from './contract';

export type RendererFactory = () => Promise<BrowserRenderer>;

export class RendererRegistry {
    private readonly factories = new Map<string, RendererFactory>();
    private readonly cache = new Map<string, BrowserRenderer>();

    register(id: string, factory: RendererFactory): void {
        this.factories.set(id, factory);
    }

    has(id: string): boolean {
        return this.factories.has(id);
    }

    async get(id: string): Promise<BrowserRenderer | undefined> {
        const cached = this.cache.get(id);
        if (cached) return cached;

        const factory = this.factories.get(id);
        if (!factory) return undefined;

        const renderer = await factory();
        this.cache.set(id, renderer);
        return renderer;
    }
}
