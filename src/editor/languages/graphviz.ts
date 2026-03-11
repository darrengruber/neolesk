import {
    buildCurlyBraceValidator,
    buildFirstLineRegexValidator,
    combineValidators,
    defineFamilyDiagramLanguage,
} from './helpers';

export default defineFamilyDiagramLanguage(
    'graphviz',
    'graphviz',
    combineValidators(
        buildFirstLineRegexValidator(/^(strict\s+)?(di)?graph\b/i, 'Graphviz diagrams must start with `graph` or `digraph`.', ['//', '#']),
        buildCurlyBraceValidator(['//', '#']),
    ),
);
