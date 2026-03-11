import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'seqdiag',
    'diag',
    combineValidators(
        buildFirstLineRegexValidator(/^seqdiag\b/, 'SeqDiag diagrams must start with `seqdiag {`.', ['//']),
        buildCurlyBraceValidator(['//']),
    ),
);
