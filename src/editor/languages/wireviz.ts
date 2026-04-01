import { defineBuiltinDiagramLanguage, yamlValidator } from './helpers';

export default defineBuiltinDiagramLanguage('wireviz', 'yaml', yamlValidator);
