import { defineExamples, lines } from '../define';

const nwdiag = defineExamples([
    {
        diagramType: "nwdiag",
        default: true,
        description: "Default",
        title: "NwDiag",
        doc: "http://blockdiag.com/en/nwdiag/index.html",
        keywords: ["network", "diagram", "architecture", "subnet", "netmask", "router"],
        source: lines([
            "nwdiag {",
            "  network dmz {",
            "    address = \"210.x.x.x/24\"",
            "",
            "    web01 [address = \"210.x.x.1\"];",
            "    web02 [address = \"210.x.x.2\"];",
            "  }",
            "  network internal {",
            "    address = \"172.x.x.x/24\";",
            "",
            "    web01 [address = \"172.x.x.1\"];",
            "    web02 [address = \"172.x.x.2\"];",
            "    db01;",
            "    db02;",
            "  }",
            "}",
        ]),
    },
]);

export default nwdiag;
