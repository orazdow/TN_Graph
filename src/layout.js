import {
  graph as createD3Graph, sugiyama, zherebko, grid,
  layeringSimplex, layeringLongestPath, layeringTopological,
  decrossTwoLayer, decrossDfs, decrossOpt,
  coordSimplex, coordGreedy, coordQuad, coordTopological,
  laneGreedy, laneOpt,
} from 'd3-dag';

import {normalizeLayout} from './layout-options.js';
export {DEFAULT_LAYOUT, normalizeLayout} from './layout-options.js';

/** d3-dag owns layout; our adapter preserves every source fact and direction. */
export function computeLayout(graph, options = {}) {
  const settings = normalizeLayout(options);
  const started = performance.now();
  if (!graph.nodes.length) return {positions: new Map(), routes: new Map(), width: 0, height: 0, cyclic: false, elapsed: 0, settings};
  const temporary = createD3Graph();
  const nodes = new Map(graph.nodes.map(node => [node.id, temporary.node(node)]));
  const loops = [];
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error('Missing endpoint for ' + edge.id);
    if (edge.source === edge.target) loops.push(edge);
    else temporary.link(nodes.get(edge.source), nodes.get(edge.target), edge);
  }
  const cyclic = !temporary.acyclic() || loops.length > 0;
  const horizontal = settings.direction === 'LR' || settings.direction === 'RL';
  const nodeSize = node => {
    const size = [Math.max(110, Math.min(280, node.data.label.length * 7 + 35)), 50];
    return horizontal ? [size[1], size[0]] : size;
  };
  let arrange;
  if (settings.algorithm === 'sugiyama') {
    const layer = settings.layering === 'simplex' ? layeringSimplex()
      : settings.layering === 'longest-path' ? layeringLongestPath().topDown(settings.longestTopDown)
      : layeringTopological();
    const decross = settings.decross === 'two-layer' ? decrossTwoLayer().passes(settings.passes)
      : settings.decross === 'dfs' ? decrossDfs() : decrossOpt();
    const coord = settings.coord === 'simplex' ? coordSimplex()
      : settings.coord === 'greedy' ? coordGreedy()
      : settings.coord === 'quadratic' ? coordQuad() : coordTopological();
    arrange = sugiyama().layering(layer).decross(decross).coord(coord);
  } else if (settings.algorithm === 'zherebko') {
    arrange = zherebko();
  } else {
    const lane = settings.lane === 'optimal' ? laneOpt().compressed(settings.compressed)
      : laneGreedy().compressed(settings.compressed).bidirectional(settings.bidirectional).topDown(settings.laneTopDown);
    arrange = grid().lane(lane);
  }
  const {width, height} = arrange.nodeSize(nodeSize).gap([settings.nodeGap, settings.rankGap])(temporary);
  const transform = (x, y) => {
    x -= width / 2; y -= height / 2;
    if (settings.direction === 'BT') return {x, y: -y};
    if (settings.direction === 'LR') return {x: y, y: x};
    if (settings.direction === 'RL') return {x: -y, y: x};
    return {x, y};
  };
  const positions = new Map([...nodes].map(([id, node]) => [id, transform(node.x, node.y)]));
  const routes = new Map([...temporary.links()].map(link => [link.data.id, link.points.map(([x, y]) => transform(x, y))]));
  const loopCounts = new Map();
  for (const edge of loops) {
    const node = nodes.get(edge.source);
    const count = loopCounts.get(edge.source) ?? 0;
    loopCounts.set(edge.source, count + 1);
    const size = 48 + count * 22;
    routes.set(edge.id, [[node.x, node.y], [node.x + size, node.y - size], [node.x - size, node.y - size], [node.x, node.y]].map(([x, y]) => transform(x, y)));
  }
  // Grid can return coincident routes for parallel facts. Keep each fact visibly separate.
  const coincident = new Map();
  for (const edge of graph.edges) {
    const key = JSON.stringify(routes.get(edge.id));
    if (!coincident.has(key)) coincident.set(key, []);
    coincident.get(key).push(edge);
  }
  for (const group of coincident.values()) {
    if (group.length < 2) continue;
    group.forEach((edge, index) => {
      const route = routes.get(edge.id);
      const a = route[0], b = route.at(-1);
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const offset = (index - (group.length - 1) / 2) * 20;
      const shift = point => ({x: point.x - (b.y - a.y) / length * offset, y: point.y + (b.x - a.x) / length * offset});
      const middle = route.length > 2 ? route.slice(1, -1) : [{x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}];
      routes.set(edge.id, [a, ...middle.map(shift), b]);
    });
  }
  return {positions, routes, width: horizontal ? height : width, height: horizontal ? width : height,
    cyclic, elapsed: performance.now() - started, settings};
}

// Compatibility for consumers of the initial layered adapter.
export function layeredLayout(graph, options) { return computeLayout(graph, {...options, algorithm: 'sugiyama'}); }

/** The first layout is intentionally just a circle; all relationships survive. */
export function circularLayout(graph) {
  const count = graph.nodes.length;
  const radius = count > 1 ? Math.max(140, count * 22) : 0;
  const positions = new Map(graph.nodes.map((node, index) => {
    const angle = index * Math.PI * 2 / count - Math.PI / 2;
    return [node.id, {x: radius * Math.cos(angle), y: radius * Math.sin(angle)}];
  }));
  const groups = new Map();
  const routes = new Map();
  for (const edge of graph.edges) {
    const key = JSON.stringify([edge.source, edge.target].sort());
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  for (const group of groups.values()) group.forEach((edge, index) => {
    const start = positions.get(edge.source);
    const end = positions.get(edge.target);
    if (!start || !end) throw new Error('Missing endpoint for ' + edge.id);
    if (edge.source === edge.target) {
      const size = 48 + index * 22;
      routes.set(edge.id, [start, {x: start.x + size, y: start.y - size}, {x: start.x - size, y: start.y - size}, end]);
    } else {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const orientation = edge.source < edge.target ? 1 : -1;
      const offset = (index - (group.length - 1) / 2) * 36 * orientation;
      routes.set(edge.id, [start, {x: (start.x + end.x) / 2 - dy / length * offset, y: (start.y + end.y) / 2 + dx / length * offset}, end]);
    }
  });
  return {positions, routes};
}

export {distanceToRoute} from './edge-paths.js';
