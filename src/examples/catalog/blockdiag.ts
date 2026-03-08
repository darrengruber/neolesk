import { defineExamples, lines } from '../define';

const blockdiag = defineExamples([
    {
        diagramType: "blockdiag",
        default: true,
        description: "Default",
        title: "BlockDiag",
        doc: "http://blockdiag.com/en/blockdiag/index.html",
        keywords: ["box", "block", "diagram"],
        source: lines([
            "blockdiag {",
            "  Kroki -> generates -> \"Block diagrams\";",
            "  Kroki -> is -> \"very easy!\";",
            "",
            "  Kroki [color = \"greenyellow\"];",
            "  \"Block diagrams\" [color = \"pink\"];",
            "  \"very easy!\" [color = \"orange\"];",
            "}",
        ]),
    },
]);

export default blockdiag;
