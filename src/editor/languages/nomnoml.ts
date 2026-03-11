import { buildSquareBracketValidator, defineFamilyDiagramLanguage } from './helpers';

export default defineFamilyDiagramLanguage('nomnoml', 'nomnoml', buildSquareBracketValidator(['//']));
