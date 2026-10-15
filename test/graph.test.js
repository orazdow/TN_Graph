import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine, selectFacts} from '../src/engine.js';
import {createGraph} from '../src/graph.js';
import {circularLayout, layeredLayout, distanceToRoute} from '../src/layout.js';

function fixture() {
  return {format: 'synthetic-truenumbers', format_version: 1,
    subjects: [{id: 'a', phrase: 'ship Aurora'}, {id: 'b', phrase: 'company Meridian'}, {id: 'c', phrase: 'unconnected subject'}],
    facts: [
      {id: 'ab1', subject_id: 'a', subject: 'ship Aurora', property: 'owner', value: {type: 'reference', subject_id: 'b', subject: 'company Meridian'}, tags: []},
      {id: 'ab2', subject_id: 'a', subject: 'ship Aurora', property: 'owner', value: {type: 'reference', subject_id: 'b', subject: 'company Meridian'}, tags: []},
      {id: 'ba', subject_id: 'b', subject: 'company Meridian', property: 'fleet', value: {type: 'reference', subject_id: 'a', subject: 'ship Aurora'}, tags: []},
      {id: 'aa', subject_id: 'a', subject: 'ship Aurora', property: 'self', value: {type: 'reference', subject_id: 'a', subject: 'ship Aurora'}, tags: []},
      ...['mass1', 'mass2'].map(id => ({id, subject_id: 'a', subject: 'ship Aurora', property: 'mass', value: {type: 'numeric', magnitude: 1200, unit: 'tonnes'}, tags: []})),
    ]};
}
function snapshot() { const engine = new Engine(); engine.add(fixture()); return engine.snapshot(); }

test('reference view retains parallel edges, cycles, self-links, and disconnected subjects', () => {
  const data = snapshot(), before = structuredClone(data), graph = createGraph(data, data.facts);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 4);
  assert.deepEqual(graph.edges.map(edge => edge.factId), data.facts.slice(0, 4).map(fact => fact.id));
  assert.deepEqual(data, before);
});

test('literal nodes are fact-specific and toggling them never changes visible facts', () => {
  const data = snapshot(), graph = createGraph(data, data.facts, {includeLiterals: true});
  const literalNodes = graph.nodes.filter(node => node.kind === 'literal');
  assert.equal(literalNodes.length, 2);
  assert.notEqual(literalNodes[0].id, literalNodes[1].id);
  assert.equal(literalNodes[0].label, literalNodes[1].label);
  assert.equal(graph.edges.length, data.facts.length);
  assert.equal(createGraph(data, data.facts).edges.length, 4);
  assert.equal(data.facts.length, 6);
});

test('filtered graph contains matching subjects and targets, including literal-only subjects', () => {
  const data = snapshot();
  const owners = createGraph(data, selectFacts(data, {property: 'owner'}), {filtered: true});
  assert.equal(owners.nodes.length, 2);
  assert.equal(owners.edges.length, 2);
  const masses = createGraph(data, selectFacts(data, {property: 'mass'}), {filtered: true});
  assert.equal(masses.nodes.length, 1);
  assert.equal(masses.edges.length, 0);
  assert.equal(createGraph(data, [], {filtered: true}).nodes.length, 0);
});

for (const [name, compute] of [['layered', layeredLayout], ['circular', circularLayout]]) {
  test(name + ' geometry preserves every edge, endpoint direction, and independent parallel routes', () => {
    const data = snapshot(), graph = createGraph(data, data.facts), before = structuredClone(graph);
    const result = compute(graph);
    assert.equal(result.positions.size, graph.nodes.length);
    assert.equal(result.routes.size, graph.edges.length);
    assert.deepEqual(graph, before);
    for (const edge of graph.edges) {
      const route = result.routes.get(edge.id);
      assert.ok(route.length >= 2);
      for (const point of route) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      const source = result.positions.get(edge.source), target = result.positions.get(edge.target);
      assert.ok(Math.abs(route[0].x - source.x) < 1e-6);
      assert.ok(Math.abs(route.at(-1).x - target.x) < 1e-6);
      assert.ok(Math.abs(route[0].y - source.y) <= 25);
      assert.ok(Math.abs(route.at(-1).y - target.y) <= 25);
    }
    assert.notDeepEqual(result.routes.get(graph.edges[0].id), result.routes.get(graph.edges[1].id));
    assert.notDeepEqual(result.routes.get(graph.edges[0].id), result.routes.get(graph.edges[2].id));
    assert.equal(compute({nodes: [], edges: []}).positions.size, 0);
    assert.equal(compute({nodes: [{id: 'alone', label: 'alone'}], edges: []}).positions.size, 1);
  });
}

test('route hit distance follows bends and handles degenerate segments', () => {
  const route = [{x: 0, y: 0}, {x: 10, y: 10}, {x: 20, y: 0}];
  assert.equal(distanceToRoute({x: 10, y: 10}, route), 0);
  assert.ok(distanceToRoute({x: 10, y: 0}, route) > 7);
  assert.equal(distanceToRoute({x: 3, y: 4}, [{x: 0, y: 0}, {x: 0, y: 0}]), 5);
});

test('bundled sample lays out all filtered facts and literal edges', () => {
  const engine = new Engine();
  const data = JSON.parse(readFileSync(new URL('../tn_generator/samples/mixed.json', import.meta.url)));
  engine.add(data);
  const collection = engine.snapshot();
  const graph = createGraph(collection, collection.facts, {includeLiterals: true});
  const result = layeredLayout(graph);
  assert.equal(graph.edges.length, data.facts.length);
  assert.equal(result.routes.size, data.facts.length);
  assert.equal(result.positions.size, graph.nodes.length);
});
