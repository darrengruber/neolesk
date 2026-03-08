import exampleData from '../examples';
import { getDiagramFiletypes, getDiagramMetadata } from './metadata';

const krokiInfo = exampleData.filter(example => example.default).reduce((previous, current) => {
    const metadata = getDiagramMetadata(current.diagramType);
    previous[current.diagramType] = {
        name: current.title,
        example: current.example,
        language: current.language || metadata.language || null,
        filetypes: getDiagramFiletypes(current.diagramType),
    };
    return previous;
}, {});

export default krokiInfo;
