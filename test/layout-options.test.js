import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine} from '../src/engine.js';
import {createGraph} from '../src/graph.js';
import {computeLayout, normalizeLayout} from '../src/layout.js';
import {makePath, buildEdgePaths, placeEdgeLabels, distanceToRoute, midpoint} from '../src/edge-paths.js';

function sampleGraph() {
  const engine = new Engine();
  engine.add(JSON.parse(readFileSync(new URL('../samples/five-subjects.json', import.meta.url))));
  const snapshot = engine.snapshot();
  return createGraph(snapshot, snapshot.facts);
}
function check(graph, geometry) {
  assert.equal(geometry.positions.size, graph.nodes.length);
  assert.equal(geometry.routes.size, graph.edges.length);
  for (const point of geometry.positions.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  for (const edge of graph.edges) {
    const route = geometry.routes.get(edge.id);
    assert.ok(route.length > 1);
    for (const point of route) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    const a = geometry.positions.get(edge.source), b = geometry.positions.get(edge.target);
    assert.ok(Math.hypot(route[0].x - a.x, route[0].y - a.y) <= 141);
    assert.ok(Math.hypot(route.at(-1).x - b.x, route.at(-1).y - b.y) <= 141);
  }
}
for (const algorithm of ['sugiyama', 'zherebko', 'grid']) {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    test(algorithm + ' ' + direction + ' preserves the cyclic sample and all parallel facts', () => {
      const graph = sampleGraph(), original = structuredClone(graph);
      const result = computeLayout(graph, {algorithm, direction});
      check(graph, result);
      assert.equal(result.cyclic, true);
      assert.deepEqual(graph, original);
      const parallel = graph.edges.filter(edge => edge.source === graph.edges[0].source && edge.target === graph.edges[0].target);
      assert.equal(parallel.length, 2);
      assert.notDeepEqual(result.routes.get(parallel[0].id), result.routes.get(parallel[1].id));
    });
  }
}

test('each Sugiyama stage choice works on the default graph', () => {
  const graph = sampleGraph();
  for (const layering of ['simplex', 'longest-path', 'topological']) {
    for (const coord of ['simplex', 'greedy', 'quadratic', 'topological']) {
      check(graph, computeLayout(graph, {layering, coord}));
    }
  }
  for (const decross of ['two-layer', 'dfs', 'optimal']) check(graph, computeLayout(graph, {decross, passes: 3}));
});

test('Grid lane options work and retain independent facts', () => {
  const graph = sampleGraph();
  for (const lane of ['greedy', 'optimal']) for (const compressed of [false, true]) {
    check(graph, computeLayout(graph, {algorithm: 'grid', lane, compressed, bidirectional: true, laneTopDown: false}));
  }
});

test('directions transform coordinates without reversing original edges', () => {
  const graph = sampleGraph();
  const tb = computeLayout(graph), bt = computeLayout(graph, {direction: 'BT'});
  for (const [id, point] of tb.positions) {
    assert.equal(bt.positions.get(id).x, point.x);
    assert.equal(bt.positions.get(id).y, -point.y);
  }
  const chain = {nodes: [{id: 'a', label: 'a'}, {id: 'b', label: 'b'}], edges: [{id: 'ab', source: 'a', target: 'b', factId: 'ab'}]};
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const result = computeLayout(chain, {direction});
    const a = result.positions.get('a'), b = result.positions.get('b');
    if (direction === 'TB') assert.ok(a.y < b.y);
    if (direction === 'BT') assert.ok(a.y > b.y);
    if (direction === 'LR') assert.ok(a.x < b.x);
    if (direction === 'RL') assert.ok(a.x > b.x);
  }
});

test('spacing changes geometry; invalid options fail explicitly; topological modes stay compatible', () => {
  const graph = sampleGraph();
  const tight = computeLayout(graph, {nodeGap: 0, rankGap: 0});
  const loose = computeLayout(graph, {nodeGap: 100, rankGap: 150});
  assert.ok(loose.width > tight.width);
  assert.ok(loose.height > tight.height);
  assert.equal(normalizeLayout({layering: 'topological', coord: 'greedy'}).coord, 'topological');
  assert.equal(normalizeLayout({coord: 'topological'}).coord, 'simplex');
  assert.throws(() => computeLayout(graph, {algorithm: 'unknown'}));
  assert.throws(() => computeLayout(graph, {nodeGap: -1}));
  assert.throws(() => computeLayout(graph, {passes: 0}));
});

test('all layouts handle self-links, empty graphs and disconnected nodes', () => {
  const graph = {nodes: [{id: 'a', label: 'a'}, {id: 'alone', label: 'alone'}], edges: [{id: 'loop', source: 'a', target: 'a'}]};
  for (const algorithm of ['sugiyama', 'zherebko', 'grid']) {
    check(graph, computeLayout(graph, {algorithm}));
    assert.equal(computeLayout({nodes: [], edges: []}, {algorithm}).positions.size, 0);
  }
});

test('curved paths retain endpoints and picking follows the displayed curve', () => {
  const route = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}];
  const curved = makePath(route, 'curved');
  assert.ok(curved.commands.some(command => command[0] === 'Q'));
  assert.deepEqual(curved.points[0], route[0]);
  assert.deepEqual(curved.points.at(-1), route.at(-1));
  assert.equal(distanceToRoute(curved.points[7], curved.points), 0);
  assert.ok(distanceToRoute({x: 100, y: 0}, curved.points) > 1);
  assert.deepEqual(makePath(route, 'routed').points, route);
  assert.deepEqual(makePath([], 'curved').points, []);
  const middle = midpoint([{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 10}]);
  assert.ok(Math.abs(middle.x - 55) < 1e-6);
  assert.equal(middle.y, 0);
});

test('edge styles keep parallel facts separate and stop paths at node boundaries', () => {
  const graph = sampleGraph(), geometry = computeLayout(graph);
  for (const style of ['curved', 'routed', 'straight']) {
    const paths = buildEdgePaths(graph, geometry, style);
    assert.equal(paths.size, graph.edges.length);
    for (const edge of graph.edges) {
      const points = paths.get(edge.id).points;
      assert.ok(points.length > 1);
      const a = geometry.positions.get(edge.source), b = geometry.positions.get(edge.target);
      assert.ok(Math.abs(Math.hypot(points[0].x - a.x, points[0].y - a.y) - 10) < 1e-6);
      assert.ok(Math.abs(Math.hypot(points.at(-1).x - b.x, points.at(-1).y - b.y) - 10) < 1e-6);
    }
    const same = graph.edges.filter(edge => edge.source === graph.edges[0].source && edge.target === graph.edges[0].target);
    assert.notDeepEqual(paths.get(same[0].id).points, paths.get(same[1].id).points);
  }
});

test('edge labels avoid reserved node areas and one another', () => {
  const items = ['a', 'b'].map(id => ({id, width: 50, points: [{x: 0, y: 0}, {x: 200, y: 0}]}));
  const obstacle = {x: 80, y: -20, width: 40, height: 40};
  const result = placeEdgeLabels(items, [obstacle], 10);
  assert.equal(result.length, 2);
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const label of result) assert.equal(overlaps(label.box, obstacle), false);
  assert.equal(overlaps(result[0].box, result[1].box), false);
});
