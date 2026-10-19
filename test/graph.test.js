import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine, selectFacts, groupFacts} from '../src/engine.js';
import {createGraph, distanceToRoute} from '../src/graph-render.js';
import {circularLayout, layeredLayout, computeLayout} from '../src/layout.js';

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
function snapshot() { const engine = new Engine(); engine.add(fixture()); return engine.getCollection(); }

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
  const data = JSON.parse(readFileSync(new URL('../tn_generator/samples/navy/navy-fleet.json', import.meta.url)));
  engine.add(data);
  const collection = engine.getCollection();
  const graph = createGraph(collection, collection.facts, {includeLiterals: true});
  const result = layeredLayout(graph);
  assert.equal(graph.edges.length, data.facts.length);
  assert.equal(result.routes.size, data.facts.length);
  assert.equal(result.positions.size, graph.nodes.length);
});

test('fact graph keeps every assertion local to its subject, including references and duplicates', () => {
  const data = snapshot(), before = structuredClone(data);
  const graph = createGraph(data, data.facts, {view: 'facts'});
  assert.equal(graph.projection, 'facts');
  assert.equal(graph.edges.length, data.facts.length);
  assert.equal(graph.nodes.length, data.subjects.length + data.facts.length);
  const roots = new Set(graph.nodes.filter(node => node.kind === 'subject').map(node => node.id));
  const targets = new Set();
  for (const fact of data.facts) {
    const edge = graph.edges.find(edge => edge.factId === fact.id);
    const value = graph.nodes.find(node => node.id === edge.target);
    assert.equal(edge.source, fact.subjectId);
    assert.equal(edge.label, fact.property);
    assert.ok(!roots.has(edge.target), 'reference values must not join a subject root');
    assert.equal(value.groupId, fact.subjectId);
    assert.equal(value.factId, fact.id, 'value selection must inspect its original assertion');
    assert.ok(!targets.has(value.id), 'duplicate assertions retain separate values');
    targets.add(value.id);
    if (fact.targetId) assert.equal(value.label, fact.value.subject);
  }
  const owners = createGraph(data, selectFacts(data, {property: 'owner'}), {view: 'facts', filtered: true});
  assert.equal(owners.nodes.filter(node => node.kind === 'subject').length, 1);
  assert.deepEqual(data, before);
  for (const algorithm of ['sugiyama', 'zherebko', 'grid']) {
    for (const direction of ['TB', 'BT', 'LR', 'RL']) {
      const geometry = computeLayout(graph, {algorithm, direction});
      assert.equal(geometry.positions.size, graph.nodes.length);
      assert.equal(geometry.routes.size, graph.edges.length);
      assert.equal(geometry.cyclic, false);
      for (const point of geometry.positions.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }
});

test('fact graph reference overlay links local values to subject roots and retains grouped geometry', () => {
  const data = snapshot(), before = structuredClone(data);
  const plain = createGraph(data, data.facts, {view: 'facts'});
  const linked = createGraph(data, data.facts, {view: 'facts-references'});
  const references = data.facts.filter(fact => fact.targetId);
  assert.deepEqual(linked.nodes, plain.nodes);
  assert.equal(linked.edges.length, data.facts.length + references.length);
  for (const fact of references) {
    const assertion = linked.edges.find(edge => edge.id === fact.id);
    const reference = linked.edges.find(edge => edge.kind === 'reference' && edge.factId === fact.id);
    assert.equal(reference.source, assertion.target);
    assert.equal(reference.target, fact.targetId);
  }
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const original = computeLayout(plain, {direction});
    const overlay = computeLayout(linked, {direction});
    assert.deepEqual(overlay.positions, original.positions, 'reference overlay must preserve subject group positions');
    assert.equal(overlay.routes.size, linked.edges.length);
    for (const edge of plain.edges) assert.deepEqual(overlay.routes.get(edge.id), original.routes.get(edge.id));
    for (const edge of linked.edges.filter(edge => edge.kind === 'reference')) {
      const route = overlay.routes.get(edge.id);
      assert.deepEqual(route[0], overlay.positions.get(edge.source));
      assert.deepEqual(route.at(-1), overlay.positions.get(edge.target));
      assert.ok(route.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    }
  }
  const filtered = createGraph(data, selectFacts(data, {property: 'owner'}), {view: 'facts-references', filtered: true});
  assert.equal(filtered.nodes.filter(node => node.kind === 'subject').length, 2, 'include reference target roots even without matching outgoing facts');
  assert.equal(computeLayout(filtered).positions.size, filtered.nodes.length);
  assert.deepEqual(data, before);
});

test('reimporting a sample adds occurrences without adding displayed edges or value nodes in any view', () => {
  const engine = new Engine();
  const sample = JSON.parse(readFileSync(new URL('../tn_generator/samples/construction/engineering-smallest-2.json', import.meta.url)));
  engine.add(sample);
  const first = engine.getCollection(); first.facts = groupFacts(first.facts);
  engine.add(sample);
  const repeated = engine.getCollection(); repeated.facts = groupFacts(repeated.facts);
  assert.equal(repeated.facts.length, 4);
  assert.ok(repeated.facts.every(fact => fact.occurrenceCount === 2));
  for (const view of ['references', 'all', 'facts', 'facts-references']) {
    const options = {view, includeLiterals: view === 'all'};
    const original = createGraph(first, first.facts, options);
    const duplicate = createGraph(repeated, repeated.facts, options);
    assert.deepEqual(duplicate, original, view);
    assert.equal(computeLayout(duplicate).routes.size, original.edges.length);
  }
});
