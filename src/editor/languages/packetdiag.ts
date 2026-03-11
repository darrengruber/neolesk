import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'packetdiag',
    'diag',
    combineValidators(
        buildFirstLineRegexValidator(/^packetdiag\b/, 'PacketDiag diagrams must start with `packetdiag {`.', ['//']),
        buildCurlyBraceValidator(['//']),
    ),
);
