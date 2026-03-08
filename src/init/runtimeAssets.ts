const runtimeAssetUrls = ['/config.js'];
const optionalRuntimeAssetUrls = ['/cache.js'];

const loadScript = (src: string): Promise<void> => new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[data-runtime-asset="${src}"]`);
    if (existingScript) {
        resolve();
        return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.runtimeAsset = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to load runtime asset: ${src}`));
    document.head.appendChild(script);
});

export const loadRuntimeAssets = async (): Promise<void> => {
    for (const url of runtimeAssetUrls) {
        await loadScript(url);
    }

    for (const url of optionalRuntimeAssetUrls) {
        try {
            await loadScript(url);
        } catch {
            // Example caches are optional in local/dev builds.
        }
    }
};

export default loadRuntimeAssets;
