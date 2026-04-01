import type { CheatSheet } from '../types';

const cheatSheets: Record<string, CheatSheet> = {
    actdiag: {
        summary: 'Activity diagram tool using a simple text syntax to describe workflows and activity flows.',
        sections: [
            { heading: 'Structure', items: ['actdiag {', '  A -> B -> C;', '}'] },
            { heading: 'Branching', items: ['A -> B, C;  (fork)', 'B -> D;', 'C -> D;  (merge)'] },
            { heading: 'Labels', items: ['A [label = "Start"];', 'A [color = "#FF0000"];'] },
            { heading: 'Lanes', items: ['lane "User" { A; B; }', 'lane "System" { C; D; }'] },
        ],
    },
    blockdiag: {
        summary: 'Simple block diagram tool for describing connected nodes with labels, colors, and grouping.',
        sections: [
            { heading: 'Structure', items: ['blockdiag {', '  A -> B -> C;', '}'] },
            { heading: 'Node styles', items: ['A [label = "Web"];', 'A [color = "#FF0000"];', 'A [style = dashed];', 'A [shape = roundedbox];'] },
            { heading: 'Shapes', items: ['box, roundedbox, diamond, ellipse', 'note, cloud, mail, beginpoint, endpoint'] },
            { heading: 'Groups', items: ['group { A; B; color = "#EEEEEE"; }'] },
            { heading: 'Edge styles', items: ['A -> B [style = dashed];', 'A -> B [label = "link"];'] },
        ],
    },
    bpmn: {
        summary: 'Business Process Model and Notation using XML. Describes workflows with events, tasks, and gateways.',
        sections: [
            { heading: 'Root element', items: ['<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">', '  <process id="p1" isExecutable="false">', '  </process>', '</definitions>'] },
            { heading: 'Events', items: ['<startEvent id="s1" name="Start"/>', '<endEvent id="e1" name="End"/>'] },
            { heading: 'Tasks', items: ['<task id="t1" name="Do something"/>', '<userTask id="ut1" name="Review"/>'] },
            { heading: 'Gateways', items: ['<exclusiveGateway id="g1" name="Decision"/>'] },
            { heading: 'Sequence flows', items: ['<sequenceFlow id="f1" sourceRef="s1" targetRef="t1"/>'] },
        ],
    },
    bytefield: {
        summary: 'Byte field diagrams for documenting binary protocols and data formats.',
        sections: [
            { heading: 'Basic fields', items: ['(def box-width 40)', '(draw-column-headers)', '(draw-box "Version" {:span 4})', '(draw-box "Length" {:span 4})'] },
            { heading: 'Spanning', items: ['(draw-box "Data" {:span 16})', '(draw-box 0x00 [:box-first :box-last])'] },
            { heading: 'Styling', items: ['(draw-box "Flag" {:fill "#a0ffa0"})', '(draw-gap "Payload")'] },
        ],
    },
    c4plantuml: {
        summary: 'C4 model diagrams using PlantUML syntax. Visualize software architecture at different levels.',
        sections: [
            { heading: 'Includes', items: ['!include <C4/C4_Context>', '!include <C4/C4_Container>', '!include <C4/C4_Component>'] },
            { heading: 'Persons & systems', items: ['Person(user, "User", "Description")', 'System(sys, "System", "Description")', 'System_Ext(ext, "External", "Description")'] },
            { heading: 'Containers', items: ['Container(web, "Web App", "React", "Description")', 'ContainerDb(db, "Database", "PostgreSQL", "Stores data")'] },
            { heading: 'Relationships', items: ['Rel(user, web, "Uses", "HTTPS")', 'Rel_D(web, db, "Reads/Writes")'] },
            { heading: 'Layout', items: ['LAYOUT_WITH_LEGEND()', 'LAYOUT_TOP_DOWN()', 'LAYOUT_LEFT_RIGHT()'] },
        ],
    },
    d2: {
        summary: 'Declarative diagramming language. Describe shapes, connections, and layouts with simple text.',
        sections: [
            { heading: 'Shapes', items: ['x: "Hello"', 'x.shape: rectangle', 'y.shape: circle', 'z.shape: diamond'] },
            { heading: 'Connections', items: ['x -> y: "label"', 'x <- y', 'x <-> y', 'x -- y  (undirected)'] },
            { heading: 'Containers', items: ['server: {', '  api: API Server', '  db: Database', '  api -> db', '}'] },
            { heading: 'Styling', items: ['x.style.fill: "#f4a261"', 'x.style.stroke: red', 'x.style.border-radius: 8'] },
            { heading: 'SQL tables', items: ['users: {', '  shape: sql_table', '  id: int {constraint: primary_key}', '  name: varchar', '}'] },
        ],
    },
    dbml: {
        summary: 'Database Markup Language for defining database schemas with tables, columns, and relationships.',
        sections: [
            { heading: 'Tables', items: ['Table users {', '  id integer [pk, increment]', '  name varchar', '  created_at timestamp', '}'] },
            { heading: 'Column settings', items: ['[pk]  (primary key)', '[ref: > table.col]  (foreign key)', '[not null]', '[unique]', '[default: 0]'] },
            { heading: 'References', items: ['Ref: orders.user_id > users.id', '> many-to-one', '< one-to-many', '- one-to-one'] },
            { heading: 'Enums', items: ['Enum status {', '  active', '  inactive', '  pending', '}'] },
        ],
    },
    diagramsnet: {
        summary: 'diagrams.net / draw.io diagrams stored as XML using mxGraphModel.',
        sections: [
            { heading: 'Root file', items: ['<mxfile>', '  <diagram name="Page-1" id="page1">', '    <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>', '  </diagram>', '</mxfile>'] },
            { heading: 'Vertices', items: ['<mxCell id="2" value="Client" vertex="1" parent="1">', '  <mxGeometry x="120" y="80" width="120" height="60" as="geometry"/>', '</mxCell>'] },
            { heading: 'Edges', items: ['<mxCell id="3" edge="1" source="2" target="4" parent="1">', '  <mxGeometry relative="1" as="geometry"/>', '</mxCell>'] },
        ],
    },
    ditaa: {
        summary: 'ASCII art diagrams converted to proper graphics. Draw boxes and arrows using text characters.',
        sections: [
            { heading: 'Boxes', items: ['+--------+', '| Label  |', '+--------+', '/--------\\  (rounded corners)'] },
            { heading: 'Arrows', items: ['----->  (right arrow)', '<-----  (left arrow)', '  |  (vertical)', '  v  (down arrow)'] },
            { heading: 'Colors', items: ['cRED  (red fill)', 'cBLU  (blue fill)', 'cGRE  (green fill)', 'cPNK  (pink fill)'] },
            { heading: 'Styles', items: ['--  (dashed line)', '..  (dotted storage shape)', '{d}  (document shape)', '{s}  (storage shape)'] },
        ],
    },
    erd: {
        summary: 'Entity-Relationship diagrams using a simple text notation for databases and data models.',
        sections: [
            { heading: 'Entities', items: ['[Person]', '[Person] {bgcolor: "#ececfc"}'] },
            { heading: 'Attributes', items: ['*name  (primary key)', '+email  (unique)', 'address'] },
            { heading: 'Relationships', items: ['Person *--1 Address', '*--* means many-to-many', '1--1 means one-to-one', '1--* means one-to-many'] },
            { heading: 'Cardinality', items: ['1 exactly one', '* zero or more', '+ one or more', '? zero or one'] },
        ],
    },
    excalidraw: {
        summary: 'Hand-drawn style diagrams defined in JSON format with elements, positions, and styling.',
        sections: [
            { heading: 'Root structure', items: ['{', '  "type": "excalidraw",', '  "elements": [],', '  "appState": { "viewBackgroundColor": "#ffffff" }', '}'] },
            { heading: 'Element types', items: ['"type": "rectangle"', '"type": "ellipse"', '"type": "diamond"', '"type": "text"', '"type": "arrow"', '"type": "line"'] },
            { heading: 'Common properties', items: ['"x": 100, "y": 100', '"width": 200, "height": 100', '"strokeColor": "#000"', '"backgroundColor": "#fff"', '"fillStyle": "hachure"'] },
        ],
    },
    graphviz: {
        summary: 'Graph visualization using DOT language. Powerful layout engine for directed and undirected graphs.',
        sections: [
            { heading: 'Directed graph', items: ['digraph G {', '  A -> B;', '  B -> C;', '}'] },
            { heading: 'Undirected graph', items: ['graph G {', '  A -- B;', '}'] },
            { heading: 'Node attributes', items: ['A [label="Label" shape=box];', 'Shapes: box, circle, diamond, ellipse,', 'record, plaintext, point, doublecircle'] },
            { heading: 'Edge attributes', items: ['A -> B [label="edge" style=dashed];', 'style: solid, dashed, dotted, bold', 'arrowhead: normal, dot, diamond, none'] },
            { heading: 'Graph attributes', items: ['rankdir=LR;  (left to right)', 'rankdir=TB;  (top to bottom)', 'bgcolor="#ffffff";', 'subgraph cluster_0 { ... }'] },
        ],
    },
    mermaid: {
        summary: 'Versatile diagramming tool supporting flowcharts, sequence, class, state, ER, Gantt, and more.',
        sections: [
            { heading: 'Flowchart', items: ['graph TD', '  A[Start] --> B{Decision}', '  B -->|Yes| C[OK]', '  B -->|No| D[End]'] },
            { heading: 'Sequence diagram', items: ['sequenceDiagram', '  Alice->>Bob: Hello', '  Bob-->>Alice: Hi', '  Note over Alice,Bob: Greeting'] },
            { heading: 'Node shapes', items: ['A[Rectangle]', 'B(Rounded)', 'C{Diamond}', 'D((Circle))', 'E([Stadium])'] },
            { heading: 'Class diagram', items: ['classDiagram', '  class Animal {', '    +String name', '    +eat() void', '  }', '  Animal <|-- Dog'] },
            { heading: 'State diagram', items: ['stateDiagram-v2', '  [*] --> Active', '  Active --> [*]'] },
        ],
    },
    nomnoml: {
        summary: 'Simple UML-like diagrams with a minimalist text syntax and customizable styling.',
        sections: [
            { heading: 'Associations', items: ['[Pirate]->[Rum]', '[Marauder]<:--[Pirate]', '[beard]--[parrot]', '[beard]-:>[foul mouth]'] },
            { heading: 'Classifiers', items: ['[Pirate|eyeCount: Int|raid();pillage()]', '[<actor>Sailor]', '[<abstract>Marauder]', '[<table>mischief | bawl | sing || yell | drink]'] },
            { heading: 'Directives', items: ['#direction: right', '#fill: #fdf6e3; #f5f5f5', '#.pirate: fill=#fdf6e3 dashed', '#fontSize: 12'] },
            { heading: 'Nested', items: ['[Pirate|eyeCount: Int|raid();pillage()|', '  [beard]--[parrot]', '  [beard]-:>[foul mouth]', ']'] },
        ],
    },
    nwdiag: {
        summary: 'Network diagrams showing network topology with nodes, networks, and IP addresses.',
        sections: [
            { heading: 'Structure', items: ['nwdiag {', '  network dmz {', '    web01 [address = "210.x.x.1"];', '  }', '}'] },
            { heading: 'Multiple networks', items: ['network internal {', '  address = "172.x.x.x/24"', '  web01; db01;', '}'] },
            { heading: 'Node styles', items: ['web01 [color = "#FF0000"];', 'web01 [shape = box];'] },
            { heading: 'Groups', items: ['group web { web01; web02; color = "#FFAAAA"; }'] },
        ],
    },
    packetdiag: {
        summary: 'Packet header diagrams for documenting network protocol packet structures.',
        sections: [
            { heading: 'Structure', items: ['packetdiag {', '  0-3: Source Port', '  4-7: Destination Port', '  8-15: Length', '}'] },
            { heading: 'Field width', items: ['colwidth = 32', '0-15: Source Port', '16-31: Dest Port'] },
            { heading: 'Styling', items: ['0-3: Version [color = "#ff0000"]', '4-7: IHL [style = dashed]'] },
        ],
    },
    pikchr: {
        summary: 'PIC-like markup language for diagrams embedded in technical documentation.',
        sections: [
            { heading: 'Objects', items: ['box "Hello"', 'circle "World"', 'ellipse "Test"', 'cylinder "DB"', 'arrow'] },
            { heading: 'Positioning', items: ['box "A"; arrow; box "B"', 'box "X" at 1cm, 2cm', 'move right 0.5cm'] },
            { heading: 'Arrows', items: ['arrow right 2cm', 'arrow from A.e to B.w', 'line dashed from X to Y'] },
            { heading: 'Styling', items: ['box "Hi" color red fill lightblue', 'box width 2cm height 1cm', 'text "label" at last box'] },
        ],
    },
    plantuml: {
        summary: 'Comprehensive UML and non-UML diagram tool supporting sequence, class, activity, component, and more.',
        sections: [
            { heading: 'Wrapper', items: ['@startuml', '... diagram content ...', '@enduml'] },
            { heading: 'Sequence', items: ['Alice -> Bob: message', 'Alice --> Bob: dashed', 'Bob ->> Alice: async', 'note right: A note'] },
            { heading: 'Class', items: ['class User {', '  +name: String', '  +login(): bool', '}', 'User "1" -- "*" Order'] },
            { heading: 'Activity', items: [':Action;', 'if (condition?) then (yes)', '  :Do A;', 'else (no)', '  :Do B;', 'endif'] },
            { heading: 'Arrows', items: ['->  solid', '-->  dashed', '->>  async', '..>  dotted', '-->>  dashed async'] },
            { heading: 'Styling', items: ['skinparam monochrome true', 'skinparam backgroundColor #EEEEEE', 'skinparam roundcorner 5'] },
        ],
    },
    rackdiag: {
        summary: 'Server rack diagrams showing hardware placement in standard 19-inch racks.',
        sections: [
            { heading: 'Structure', items: ['rackdiag {', '  16U;', '  1: UPS', '  2: DB Server', '  3: Web Server', '}'] },
            { heading: 'Multi-unit', items: ['1: UPS [2U];', '3: Server [4U, color="#FF0000"];'] },
            { heading: 'Multiple racks', items: ['rack {', '  description = "Rack 1"', '  1: Server A', '}'] },
        ],
    },
    seqdiag: {
        summary: 'Sequence diagrams with a simple text syntax for modeling interactions between components.',
        sections: [
            { heading: 'Structure', items: ['seqdiag {', '  A -> B [label = "request"];', '  B -> A [label = "response"];', '}'] },
            { heading: 'Arrow types', items: ['A -> B  (solid)', 'A --> B  (dashed)', 'A ->> B  (async)'] },
            { heading: 'Notes', items: ['A -> B [note = "A note"];'] },
            { heading: 'Separators', items: ['=== separator ===', '... delay ...'] },
            { heading: 'Styling', items: ['A [color = "#FF0000"];', 'A -> B [color = "#0000FF"];'] },
        ],
    },
    structurizr: {
        summary: 'Software architecture diagrams using the C4 model with the Structurizr DSL.',
        sections: [
            { heading: 'Workspace', items: ['workspace {', '  model { ... }', '  views { ... }', '}'] },
            { heading: 'Model elements', items: ['person user "User" "A user"', 'softwareSystem sys "System" "Description"', 'container web "Web App" "React"', 'component api "API" "REST"'] },
            { heading: 'Relationships', items: ['user -> sys "Uses"', 'web -> api "Calls" "HTTPS"'] },
            { heading: 'Views', items: ['systemContext sys "ctx" {', '  include *', '  autoLayout', '}'] },
        ],
    },
    svgbob: {
        summary: 'ASCII art to SVG converter. Draw diagrams using text characters that get converted to smooth SVG.',
        sections: [
            { heading: 'Lines', items: ['----  horizontal', '|  vertical', '/  diagonal up', '\\  diagonal down'] },
            { heading: 'Arrows', items: ['--->  right arrow', '<---  left arrow', '  ^  up arrow', '  v  down arrow'] },
            { heading: 'Shapes', items: ['.----.', '|    |  rectangle', "'----'", '  /\\  triangle', ' /  \\'] },
            { heading: 'Rounded', items: ['.----.', '(    )  rounded', "'----'"] },
            { heading: 'Text', items: ['Place text directly in the diagram', '"Quoted text" for labels'] },
        ],
    },
    symbolator: {
        summary: 'HDL component symbol diagrams from SystemVerilog or VHDL module/entity definitions.',
        sections: [
            { heading: 'Module definition', items: ['module my_module (', '  input wire clk,', '  input wire rst,', '  output reg [7:0] data', ');', 'endmodule'] },
            { heading: 'Port types', items: ['input wire  (input signal)', 'output wire  (output signal)', 'inout wire  (bidirectional)', 'input wire [7:0]  (bus)'] },
        ],
    },
    tikz: {
        summary: 'LaTeX TikZ/PGF graphics for creating publication-quality diagrams with precise control.',
        sections: [
            { heading: 'Document', items: ['\\documentclass{standalone}', '\\usepackage{tikz}', '\\begin{document}', '\\begin{tikzpicture}', '...', '\\end{tikzpicture}', '\\end{document}'] },
            { heading: 'Basic shapes', items: ['\\draw (0,0) -- (1,1);', '\\draw (0,0) circle (1cm);', '\\draw (0,0) rectangle (2,1);', '\\node at (1,1) {Text};'] },
            { heading: 'Arrows', items: ['\\draw[->] (0,0) -- (1,0);', '\\draw[<->] (0,0) -- (1,0);', '\\draw[->, thick] (0,0) -- (1,0);'] },
            { heading: 'Styling', items: ['\\draw[red, thick] ...', '\\draw[fill=blue!20] ...', '\\draw[dashed] ...'] },
        ],
    },
    umlet: {
        summary: 'UML diagrams defined in XML/UXF format with simple text-based element definitions.',
        sections: [
            { heading: 'Root', items: ['<diagram program="umlet">', '  <element>...</element>', '</diagram>'] },
            { heading: 'Element', items: ['<element>', '  <id>UMLClass</id>', '  <coordinates>', '    <x>10</x><y>10</y>', '    <w>100</w><h>60</h>', '  </coordinates>', '  <panel_attributes>ClassName', '--', '+method()', '  </panel_attributes>', '</element>'] },
            { heading: 'Types', items: ['UMLClass, UMLObject, UMLPackage', 'UMLActor, UMLUseCase, UMLNote', 'Relation'] },
        ],
    },
    vega: {
        summary: 'Declarative visualization grammar in JSON. Build interactive charts with precise data-driven mappings.',
        sections: [
            { heading: 'Top-level', items: ['{', '  "$schema": "https://vega.github.io/schema/vega/v5.json",', '  "width": 400,', '  "height": 200,', '  "data": [],', '  "marks": []', '}'] },
            { heading: 'Data', items: ['"data": [{ "name": "table",', '  "values": [{"x": 1, "y": 28}]', '}]'] },
            { heading: 'Scales', items: ['"scales": [{ "name": "x",', '  "type": "linear",', '  "domain": {"data":"table","field":"x"},', '  "range": "width"', '}]'] },
            { heading: 'Marks', items: ['"marks": [{ "type": "rect",', '  "from": {"data": "table"},', '  "encode": { "enter": {', '    "x": {"scale":"x","field":"x"}', '  }}', '}]'] },
        ],
    },
    vegalite: {
        summary: 'High-level grammar for interactive visualizations. Concise JSON syntax for common chart types.',
        sections: [
            { heading: 'Basic chart', items: ['{', '  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",', '  "data": { "values": [] },', '  "mark": "bar",', '  "encoding": {}', '}'] },
            { heading: 'Mark types', items: ['"mark": "bar"', '"mark": "line"', '"mark": "point"', '"mark": "area"', '"mark": "circle"'] },
            { heading: 'Encoding', items: ['"encoding": {', '  "x": {"field": "a", "type": "ordinal"},', '  "y": {"field": "b", "type": "quantitative"},', '  "color": {"field": "c", "type": "nominal"}', '}'] },
            { heading: 'Data types', items: ['"quantitative"  (numbers)', '"ordinal"  (ordered categories)', '"nominal"  (unordered categories)', '"temporal"  (dates/times)'] },
        ],
    },
    wavedrom: {
        summary: 'Digital timing diagrams in JSON. Describe waveforms, signal groups, and annotations.',
        sections: [
            { heading: 'Basic signal', items: ['{ "signal": [', '  { "name": "clk", "wave": "p......." },', '  { "name": "data", "wave": "x.345x.." }', ']}'] },
            { heading: 'Wave characters', items: ['p/n  positive/negative clock', '0/1  low/high', 'x  undefined', '=  data (use "data" array)', '.  continue previous'] },
            { heading: 'Groups', items: ['["Group name",', '  { "name": "sig1", "wave": "01." },', '  { "name": "sig2", "wave": "0.1" }', ']'] },
            { heading: 'Edges & arrows', items: ['"edge": ["a~>b text", "c-~>d"]', 'a~b  spline, a-b  sharp, a~>b  arrow'] },
        ],
    },
    wireviz: {
        summary: 'Wiring harness diagrams in YAML. Document cables, connectors, and pin assignments.',
        sections: [
            { heading: 'Connectors', items: ['connectors:', '  X1:', '    type: Molex', '    pincount: 4', '    pins: [1, 2, 3, 4]'] },
            { heading: 'Cables', items: ['cables:', '  W1:', '    wirecount: 3', '    color_code: DIN', '    length: 1 m'] },
            { heading: 'Connections', items: ['connections:', '  -', '    - X1: [1, 2, 3]', '    - W1: [1, 2, 3]', '    - X2: [1, 2, 3]'] },
        ],
    },
};

export default cheatSheets;
