import { defineBuiltinDiagramLanguage, xmlValidator } from './helpers';

export default defineBuiltinDiagramLanguage('umlet', 'xml', xmlValidator);
