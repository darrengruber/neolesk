import { defineExamples, lines } from '../define';

const rackdiag = defineExamples([
    {
        diagramType: "rackdiag",
        default: true,
        description: "Default",
        title: "RackDiag",
        doc: "http://blockdiag.com/en/nwdiag/index.html",
        keywords: ["rack", "diagram", "switch", "router", "load balancer", "blade", "server"],
        source: lines([
            "rackdiag {",
            "  16U;",
            "  1: UPS [2U];",
            "  3: DB Server;",
            "  4: Web Server;",
            "  5: Web Server;",
            "  6: Web Server;",
            "  7: Load Balancer;",
            "  8: L3 Switch;",
            "}",
        ]),
    },
]);

export default rackdiag;
