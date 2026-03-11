import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'blockdiag',
    'diag',
    combineValidators(
        buildFirstLineRegexValidator(/^blockdiag\b/, 'BlockDiag diagrams must start with `blockdiag {`.', ['//']),
        buildCurlyBraceValidator(['//']),
    ),
);
