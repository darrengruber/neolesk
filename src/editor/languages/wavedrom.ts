import { defineBuiltinDiagramLanguage, jsonValidator } from './helpers';

export default defineBuiltinDiagramLanguage('wavedrom', 'json', jsonValidator);
