import { Platform } from 'react-native';

const CACHE_NAME = 'neolesk-svg-v1';

const canUseCache = Platform.OS === 'web' && typeof caches !== 'undefined';

/**
 * Fetch an SVG with a two-tier cache:
 * 1. Check Cache API (instant, persisted across sessions)
 * 2. Try a local static file (build-time pre-rendered, same origin)
 * 3. Fetch from remote (kroki), cache the response
 *
 * @param url        The canonical URL (e.g. kroki endpoint) used as cache key
 * @param localPath  Optional path to a build-time static copy (e.g. ./cache/abc.svg)
 * @param signal     AbortSignal for cancellation
 */
export const cachedSvgFetch = async (
    url: string,
    localPath?: string | null,
    signal?: AbortSignal,
): Promise<Response> => {
    if (!canUseCache) return fetch(url, { signal });

    const cache = await caches.open(CACHE_NAME);

    // Tier 1: Cache API hit
    const cached = await cache.match(url);
    if (cached) return cached;

    // Tier 2: Build-time static file
    if (localPath) {
        try {
            const local = await fetch(localPath, { signal });
            if (local.ok) {
                const body = await local.text();
                if (body.includes('<svg')) {
                    const synthetic = new Response(body, {
                        headers: { 'Content-Type': 'image/svg+xml' },
                    });
                    await cache.put(url, synthetic.clone());
                    return synthetic;
                }
            }
        } catch {
            // Static file missing, fall through
        }
    }

    // Tier 3: Remote fetch
    const response = await fetch(url, { signal });
    if (response.ok) {
        cache.put(url, response.clone());
    }
    return response;
};
