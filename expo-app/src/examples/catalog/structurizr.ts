import { defineExamples, lines } from '../define';

const structurizr = defineExamples([
    {
        diagramType: "structurizr",
        default: true,
        description: "Default",
        title: "Structurizr",
        doc: "https://github.com/structurizr/dsl/blob/master/docs/language-reference.md",
        keywords: ["architecture", "model", "C4", "DSL"],
        source: lines([
            "workspace {",
            "    model {",
            "        user = person \"User\"",
            "        softwareSystem = softwareSystem \"Software System\"",
            "        user -> softwareSystem \"Uses\"",
            "    }",
            "    views {",
            "        systemContext softwareSystem {",
            "            include *",
            "            autolayout",
            "        }",
            "        theme default",
            "    }",
            "}",
        ]),
    },
]);

export default structurizr;
