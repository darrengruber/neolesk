export const parseSvgDimensions = (svgText: string): { width: number; height: number } | null => {
    const document = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = document.querySelector('svg');
    if (!svg) return null;

    const width = Number.parseFloat(svg.getAttribute('width') || '');
    const height = Number.parseFloat(svg.getAttribute('height') || '');
    if (width > 0 && height > 0) return { width, height };

    const viewBox = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
        return { width: viewBox[2], height: viewBox[3] };
    }
    return null;
};

export const createSvgBlobUrl = (svgText: string): string => (
    URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
);

const loadImage = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to read rendered diagram dimensions'));
    image.src = source;
});

export const getDimensions = async (
    svgText: string,
    blobUrl: string,
): Promise<{ width: number; height: number }> => {
    const parsed = parseSvgDimensions(svgText);
    if (parsed) return parsed;
    const image = await loadImage(blobUrl);
    return image.naturalWidth > 0 && image.naturalHeight > 0
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : { width: 800, height: 600 };
};
