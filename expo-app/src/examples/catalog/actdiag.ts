import { defineExamples, lines } from '../define';

const actdiag = defineExamples([
    {
        diagramType: "actdiag",
        default: true,
        description: "Default",
        title: "ActDiag",
        doc: "http://blockdiag.com/en/actdiag/index.html",
        keywords: ["UML", "activity", "diagram", "swimlane"],
        source: lines([
            "actdiag {",
            "  write -> convert -> image",
            "",
            "  lane user {",
            "    label = \"User\"",
            "    write [label = \"Writing text\"];",
            "    image [label = \"Get diagram image\"];",
            "  }",
            "  lane Kroki {",
            "    convert [label = \"Convert text to image\"];",
            "  }",
            "}",
        ]),
    },
]);

export default actdiag;
