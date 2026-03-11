import { buildFenceValidator, defineFamilyDiagramLanguage } from './helpers';

export default defineFamilyDiagramLanguage('tikz', 'tikz', buildFenceValidator('\\begin{tikzpicture}', '\\end{tikzpicture}'));
