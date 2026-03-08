interface RuntimeAsset {
    src: string;
    optional?: boolean;
}

const runtimeAssets: RuntimeAsset[] = [
    { src: '/config.js', optional: true },
];

const loadScript = ({ src, optional = false }: RuntimeAsset): Promise<void> => new Promise((resolve, reject) => {
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
    script.onerror = () => {
        script.remove();

        if (optional) {
            resolve();
            return;
        }

        reject(new Error(`Unable to load runtime asset: ${src}`));
    };
    document.head.appendChild(script);
});

export const loadRuntimeAssets = async (): Promise<void> => {
    for (const asset of runtimeAssets) {
        await loadScript(asset);
    }
};

export default loadRuntimeAssets;
