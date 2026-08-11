/**
 * Runtime configuration, read from /config.json after the app mounts.
 *
 * This exists so a deployment can point the app at a different Kroki engine
 * without a rebuild — the in-cluster deployment mounts a ConfigMap over this
 * path to select the self-hosted engine, while the public Cloudflare Pages
 * build ships no config.json at all and keeps the build-time default.
 *
 * THE STATUS CODE CANNOT TELL YOU WHETHER A CONFIG EXISTS. Every host that
 * serves this app has an SPA fallback, so a request for a file that is not
 * there returns **200 with index.html**, not 404. The previous version of this
 * code did `res.ok ? res.json() : null` and swallowed the resulting parse
 * error, which meant three very different situations were indistinguishable
 * and all silent:
 *
 *   1. no config deployed          — correct, use the build-time default
 *   2. config deployed but invalid — a real misconfiguration
 *   3. config deployed and fine    — apply it
 *
 * Case 2 is the one that matters: the app would quietly render against the
 * wrong engine forever and look completely healthy. So discriminate on the
 * content type, and say something when a config is present but unusable.
 */

export interface RuntimeConfig {
    krokiEngineUrl?: string;
}

export type RuntimeConfigOutcome =
    /** No config.json is deployed. Expected; keep the build-time default. */
    | { status: 'absent' }
    /** A config.json was served and parsed. */
    | { status: 'loaded'; config: RuntimeConfig }
    /** A config.json was served and is unusable. The caller should complain. */
    | { status: 'invalid'; reason: string };

export const RUNTIME_CONFIG_PATH = '/config.json';

/**
 * Fetch and classify the runtime config. Never throws — a deployment concern
 * must not be able to take the editor down.
 */
export const loadRuntimeConfig = async (
    fetchImpl: typeof fetch = fetch,
    path: string = RUNTIME_CONFIG_PATH,
): Promise<RuntimeConfigOutcome> => {
    let response: Response;

    try {
        response = await fetchImpl(path, { headers: { Accept: 'application/json' } });
    } catch (error) {
        // Offline, blocked, DNS — indistinguishable from "not deployed" from
        // here, and equally not worth breaking the app over.
        return { status: 'absent' };
    }

    // An honest 404 from a host without SPA fallback.
    if (response.status === 404) {
        return { status: 'absent' };
    }

    if (!response.ok) {
        return { status: 'invalid', reason: `HTTP ${response.status} fetching ${path}` };
    }

    // The SPA fallback case: index.html served in place of the missing file.
    // This is the normal "no config" path on Cloudflare Pages and on
    // static-web-server, so it must NOT be reported as an error.
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
        return { status: 'absent' };
    }

    let parsed: unknown;
    try {
        parsed = await response.json();
    } catch (error) {
        return {
            status: 'invalid',
            reason: `${path} is served as JSON but does not parse: ${String(error)}`,
        };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { status: 'invalid', reason: `${path} is not a JSON object` };
    }

    const config = parsed as Record<string, unknown>;
    const engine = config.krokiEngineUrl;

    if (engine !== undefined && typeof engine !== 'string') {
        return { status: 'invalid', reason: `${path}: krokiEngineUrl must be a string` };
    }

    if (typeof engine === 'string' && engine.trim() === '') {
        return { status: 'invalid', reason: `${path}: krokiEngineUrl is empty` };
    }

    return { status: 'loaded', config: engine === undefined ? {} : { krokiEngineUrl: engine } };
};
