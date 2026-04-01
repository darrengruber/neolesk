import { defineBuiltinDiagramLanguage, jsonValidator } from './helpers';

export default defineBuiltinDiagramLanguage('excalidraw', 'json', jsonValidator);
