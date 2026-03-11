import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'nwdiag',
    'diag',
    combineValidators(
        buildFirstLineRegexValidator(/^nwdiag\b/, 'NwDiag diagrams must start with `nwdiag {`.', ['//']),
        buildCurlyBraceValidator(['//']),
    ),
);
