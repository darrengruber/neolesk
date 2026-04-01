import { buildFirstLineRegexValidator, defineFamilyDiagramLanguage } from './helpers';

export default defineFamilyDiagramLanguage(
    'mermaid',
    'mermaid',
    buildFirstLineRegexValidator(
        /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|xychart-beta|block-beta|architecture-beta)\b/,
        'Mermaid diagrams must start with a valid top-level diagram keyword.',
        ['%%'],
    ),
);
