import { buildFenceValidator, defineFamilyDiagramLanguage } from './helpers';

export default defineFamilyDiagramLanguage('c4plantuml', 'plantuml', buildFenceValidator('@startuml', '@enduml'));
