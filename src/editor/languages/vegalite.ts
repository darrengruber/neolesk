import { defineBuiltinDiagramLanguage, jsonValidator } from './helpers';

export default defineBuiltinDiagramLanguage('vegalite', 'json', jsonValidator);
