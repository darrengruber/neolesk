import { defineBuiltinDiagramLanguage, xmlValidator } from './helpers';

export default defineBuiltinDiagramLanguage('diagramsnet', 'xml', xmlValidator);
