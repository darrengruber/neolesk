import { describe, expect, it } from 'vitest';
import { createD2DagreEvaluator } from './d2DagreRuntime';

describe('D2 Dagre runtime', () => {
    it('interprets the fixed command protocol emitted by D2 WASM without dynamic evaluation', () => {
        const evaluate = createD2DagreEvaluator();

        evaluate('(function(f){/* dagre bundle */ g.dagre=f()}})(function(){})');
        evaluate(`var g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
g.setDefaultNodeLabel(function () {
  return {};
});
g.setDefaultEdgeLabel(function () {
  return {};
});`);
        evaluate(`g.setGraph({
  ranksep: 100,
  edgesep: 20,
  nodesep: 60,
  rankdir: "TB",
});`);
        evaluate(`g.setNode(\`0\`, { id: \`0\`, width: 100, height: 100 });
g.setNode(\`1\`, { id: \`1\`, width: 53, height: 66 });
g.setParent(\`1\`, \`0\`);
g.setNode(\`2\`, { id: \`2\`, width: 53, height: 66 });
g.setEdge({v:\`1\`, w:\`2\`, name:\`(a -> b)[0]\`}, { width:0, height:0, labelpos: \`c\` });`);
        evaluate('dagre.layout(g)');

        expect(JSON.parse(evaluate('JSON.stringify(g.node(g.nodes()[0]))') as string)).toEqual(expect.objectContaining({
            id: '0', x: expect.any(Number), y: expect.any(Number),
        }));
        expect(JSON.parse(evaluate('JSON.stringify(g.edge(g.edges()[0]))') as string)).toEqual(expect.objectContaining({
            points: expect.any(Array),
        }));
    });

    it('rejects commands outside the D2 Dagre protocol', () => {
        const evaluate = createD2DagreEvaluator();
        expect(() => evaluate('globalThis.compromised = true')).toThrow('Unsupported D2 Dagre command');
    });
});
