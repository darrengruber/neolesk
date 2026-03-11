import { defineBuiltinDiagramLanguage, jsonValidator } from './helpers';

export default defineBuiltinDiagramLanguage('vega', 'json', jsonValidator);
