import { layout } from 'dagre-d3-es/src/dagre/layout.js';
import { Graph } from 'dagre-d3-es/src/graphlib/index.js';

type DagreGraph = InstanceType<typeof Graph>;

const parseNumberProperty = (source: string, property: string): number | undefined => {
    const match = source.match(new RegExp(`\\b${property}:\\s*(-?[\\d.]+)`));
    return match ? Number(match[1]) : undefined;
};

const parseStringProperty = (source: string, property: string): string | undefined => {
    const match = source.match(new RegExp(`\\b${property}:\\s*"([^"]*)"`));
    return match?.[1];
};

const requireGraph = (graph: DagreGraph | null): DagreGraph => {
    if (!graph) throw new Error('D2 Dagre graph has not been initialized');
    return graph;
};

export const createD2DagreEvaluator = (): ((source: string) => unknown) => {
    let graph: DagreGraph | null = null;

    return (source) => {
        const command = String(source).trim();
        if (command.startsWith('(function(f){') && command.includes('g.dagre=f()')) return undefined;

        if (command.startsWith('var g = new dagre.graphlib.Graph(')) {
            graph = new Graph({ compound: true, multigraph: true });
            graph.setDefaultNodeLabel(() => ({}));
            graph.setDefaultEdgeLabel(() => ({}));
            return undefined;
        }

        if (command.startsWith('g.setGraph({')) {
            const target = requireGraph(graph);
            target.setGraph({
                ranksep: parseNumberProperty(command, 'ranksep'),
                edgesep: parseNumberProperty(command, 'edgesep'),
                nodesep: parseNumberProperty(command, 'nodesep'),
                rankdir: parseStringProperty(command, 'rankdir'),
            });
            return undefined;
        }

        if (command.startsWith('g.setNode(')) {
            const target = requireGraph(graph);
            const statement = /g\.setNode\(`([^`]*)`, \{ id: `([^`]*)`, width: (-?[\d.]+), height: (-?[\d.]+) \}\);/g;
            const parent = /g\.setParent\(`([^`]*)`, `([^`]*)`\);/g;
            const edge = /g\.setEdge\(\{v:`([^`]*)`, w:`([^`]*)`, name:`((?:\\.|[^`])*)`\}, \{ width:(-?[\d.]+), height:(-?[\d.]+), labelpos: `([^`]*)` \}\);/g;
            let consumed = command;
            consumed = consumed.replace(statement, (_match, id, labelId, width, height) => {
                target.setNode(id, { id: labelId, width: Number(width), height: Number(height) });
                return '';
            });
            consumed = consumed.replace(parent, (_match, child, parentId) => {
                target.setParent(child, parentId);
                return '';
            });
            consumed = consumed.replace(edge, (_match, v, w, name, width, height, labelpos) => {
                target.setEdge({ v, w, name }, { width: Number(width), height: Number(height), labelpos });
                return '';
            });
            if (consumed.trim()) throw new Error(`Unsupported D2 Dagre graph command: ${consumed.trim()}`);
            return undefined;
        }

        if (command === 'dagre.layout(g)') {
            layout(requireGraph(graph), undefined);
            return undefined;
        }

        const node = command.match(/^JSON\.stringify\(g\.node\(g\.nodes\(\)\[(\d+)]\)\)$/);
        if (node) {
            const target = requireGraph(graph);
            return JSON.stringify(target.node(target.nodes()[Number(node[1])]));
        }

        const edge = command.match(/^JSON\.stringify\(g\.edge\(g\.edges\(\)\[(\d+)]\)\)$/);
        if (edge) {
            const target = requireGraph(graph);
            return JSON.stringify(target.edge(target.edges()[Number(edge[1])]));
        }

        throw new Error(`Unsupported D2 Dagre command: ${command.slice(0, 120)}`);
    };
};
