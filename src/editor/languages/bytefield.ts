import { buildParenthesisValidator, defineFamilyDiagramLanguage } from './helpers';

export default defineFamilyDiagramLanguage('bytefield', 'bytefield', buildParenthesisValidator([';']));
