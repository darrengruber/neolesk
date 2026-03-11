import { defineBuiltinDiagramLanguage, xmlValidator } from './helpers';

export default defineBuiltinDiagramLanguage('bpmn', 'xml', xmlValidator);
