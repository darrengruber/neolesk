import { defineExamples, lines } from '../define';

const seqdiag = defineExamples([
    {
        diagramType: "seqdiag",
        default: true,
        description: "Default",
        title: "SeqDiag",
        doc: "http://blockdiag.com/en/seqdiag/index.html",
        keywords: ["UML", "sequence", "diagram"],
        source: lines([
            "seqdiag {",
            "  browser  -> webserver [label = \"GET /seqdiag/svg/base64\"];",
            "  webserver  -> processor [label = \"Convert text to image\"];",
            "  webserver <-- processor;",
            "  browser <-- webserver;",
            "}",
        ]),
    },
]);

export default seqdiag;
