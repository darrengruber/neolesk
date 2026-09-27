/**
 * A tab opened before a deploy still runs the old build. Its lazily loaded
 * engines (Mermaid, D2, PlantUML...) point at hashed chunk names that the new
 * deploy removed, and the host answers those with index.html. The engine then
 * fails with "'text/html' is not a valid JavaScript MIME type" or a follow-on
 * error such as "undefined is not an object (evaluating 'd2.compile')".
 *
 * When a render fails, compare the running entry script with the one the
 * deployed page loads. If they differ, reload once to pick up the new build:
 * the diagram survives, because a solo diagram lives in the URL and a session
 * lives on the server. After the reload the builds match, so it cannot loop.
 */

const ENTRY_SCRIPT = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/i;

export const entryScriptOf = (html: string): string | null => ENTRY_SCRIPT.exec(html)?.[1] ?? null;

const pathOf = (url: string): string => new URL(url, 'http://neolesk.invalid/').pathname;

/** The built entry script of this page; null in development, where Vite serves source. */
export const runningEntryScript = (): string | null => {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    return src && /\/assets\/[^/]+\.js$/.test(pathOf(src)) ? pathOf(src) : null;
};

export const newBuildAvailable = async ({
    fetchImpl = fetch,
    running = runningEntryScript,
}: {
    fetchImpl?: typeof fetch;
    running?: () => string | null;
} = {}): Promise<boolean> => {
    const current = running();
    if (!current) return false;
    try {
        const response = await fetchImpl('/', { cache: 'no-store', headers: { accept: 'text/html' } });
        if (!response.ok) return false;
        const deployed = entryScriptOf(await response.text());
        return Boolean(deployed) && pathOf(deployed as string) !== current;
    } catch {
        return false;
    }
};

let checking: Promise<boolean> | null = null;

/** Reload into the deployed build if this tab is older. Returns whether it reloads. */
export const reloadIfNewBuild = (): Promise<boolean> => {
    checking ??= newBuildAvailable().then((available) => {
        if (available) window.location.reload();
        checking = null;
        return available;
    });
    return checking;
};
