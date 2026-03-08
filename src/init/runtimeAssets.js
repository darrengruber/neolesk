const runtimeAssetUrls = ['/config.js', '/config-analytic-providers.js', '/cache.js'];

const loadScript = (src) => new Promise((resolve, reject) => {
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

export const loadRuntimeAssets = async () => {
    for (const url of runtimeAssetUrls) {
        await loadScript(url);
    }
};

export default loadRuntimeAssets;
