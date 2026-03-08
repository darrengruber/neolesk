import { defineExamples, lines } from '../define';

const symbolator = defineExamples([
    {
        diagramType: "symbolator",
        default: true,
        description: "Default",
        title: "Symbolator",
        doc: "https://zebreus.github.io/symbolator/",
        keywords: ["hardware", "diagram", "rtl", "verilog", "vhdl", "ports"],
        source: lines([
            "module demo_device #(",
            "    //# {{}}",
            "    parameter SIZE = 8,",
            "    parameter RESET_ACTIVE_LEVEL = 1",
            ") (",
            "    //# {{clocks|Clocking}}",
            "    input wire clock,",
            "    //# {{control|Control signals}}",
            "    input wire reset,",
            "    input wire enable,",
            "    //# {{data|Data ports}}",
            "    input wire [SIZE-1:0] data_in,",
            "    output wire [SIZE-1:0] data_out",
            ");",
            "  // ...",
            "endmodule",
        ]),
    },
]);

export default symbolator;
