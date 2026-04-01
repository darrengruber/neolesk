import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'actdiag',
    'diag',
    combineValidators(
        buildFirstLineRegexValidator(/^actdiag\b/, 'ActDiag diagrams must start with `actdiag {`.', ['//']),
        buildCurlyBraceValidator(['//']),
    ),
);
