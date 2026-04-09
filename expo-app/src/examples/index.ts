import baseData from './catalog';
import diagramMetadata from '../kroki/metadata';
import type { ExampleDefinition } from '../types';
const mergedData: ExampleDefinition[] = baseData.map((item) => {
    const metadata = diagramMetadata[item.diagramType] || {};
    if (item.language || !metadata.language) {
        return item;
    }
    return { ...item, language: metadata.language };
});

export default mergedData;
