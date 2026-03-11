import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'rackdiag',
    'diag',
    combineValidators(
        buildFirstLineRegexValidator(/^rackdiag\b/, 'RackDiag diagrams must start with `rackdiag {`.', ['//']),
        buildCurlyBraceValidator(['//']),
    ),
);
