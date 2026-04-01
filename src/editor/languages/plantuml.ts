import { buildFenceValidator, defineFamilyDiagramLanguage } from './helpers';

export default defineFamilyDiagramLanguage('plantuml', 'plantuml', buildFenceValidator('@startuml', '@enduml'));
