import {
  graph as createD3Graph, sugiyama, zherebko, grid,
  layeringSimplex, layeringLongestPath, layeringTopological,
  decrossTwoLayer, decrossDfs, decrossOpt,
  coordSimplex, coordGreedy, coordQuad, coordTopological,
  laneGreedy, laneOpt,
} from 'd3-dag';

export const DEFAULT_LAYOUT = Object.freeze({
  algorithm: 'sugiyama', direction: 'TB', layering: 'simplex',
  decross: 'two-layer', coord: 'greedy', passes: 24,
  nodeGap: 45, rankGap: 70, longestTopDown: true,
  lane: 'greedy', compressed: true, bidirectional: false, laneTopDown: true,
});

export function normalizeLayout(options = {}) {
  const settings = {...DEFAULT_LAYOUT, ...options};
  for (const [key, values] of Object.entries({
    algorithm: ['sugiyama', 'zherebko', 'grid'], direction: ['TB', 'BT', 'LR', 'RL'],
    layering: ['simplex', 'longest-path', 'topological'], decross: ['two-layer', 'dfs', 'optimal'],
    coord: ['simplex', 'greedy', 'quadratic', 'topological'], lane: ['greedy', 'optimal'],
  })) if (!values.includes(settings[key])) throw new Error('Unknown layout ' + key + ': ' + settings[key]);
  for (const key of ['nodeGap', 'rankGap']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 300) throw new Error(key + ' must be between 0 and 300');
  }
  if (!Number.isInteger(settings.passes) || settings.passes < 1 || settings.passes > 48) throw new Error('Crossing passes must be between 1 and 48');
  if (settings.layering === 'topological') settings.coord = 'topological';
  else if (settings.coord === 'topological') settings.coord = DEFAULT_LAYOUT.coord;
  return settings;
}

/** d3-dag owns layout; our adapter preserves every source fact and direction. */
export function computeLayout(graph, options = {}) {
  const settings = normalizeLayout(options);
  const started = performance.now();
  if (!graph.nodes.length) return {positions: new Map(), routes: new Map(), width: 0, height: 0, cyclic: false, elapsed: 0, settings};
  // Fact graphs keep each subject's assertions together, independent of references.
  if (graph.projection === 'facts') {
    const groups = new Map();
    for (const node of graph.nodes) {
      if (!groups.has(node.groupId)) groups.set(node.groupId, {nodes: [], edges: []});
      groups.get(node.groupId).nodes.push(node);
    }
    for (const edge of graph.edges) {
      if (edge.kind !== 'reference') groups.get(edge.source).edges.push(edge);
    }
    const layouts = [...groups.values()].map(group => ({group, geometry: computeLayout(group, settings)}));
    const columns = Math.ceil(Math.sqrt(layouts.length));
    const gap = 100;
    const widths = Array(columns).fill(0);
    const heights = Array(Math.ceil(layouts.length / columns)).fill(0);
    layouts.forEach(({geometry}, index) => {
      widths[index % columns] = Math.max(widths[index % columns], geometry.width);
      heights[Math.floor(index / columns)] = Math.max(heights[Math.floor(index / columns)], geometry.height);
    });
    const width = widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1);
    const height = heights.reduce((sum, value) => sum + value, 0) + gap * (heights.length - 1);
    const positions = new Map(), routes = new Map();
    layouts.forEach(({geometry}, index) => {
      const col = index % columns, row = Math.floor(index / columns);
      const dx = widths.slice(0, col).reduce((sum, value) => sum + value + gap, 0) + widths[col] / 2 - width / 2;
      const dy = heights.slice(0, row).reduce((sum, value) => sum + value + gap, 0) + heights[row] / 2 - height / 2;
      const translate = point => ({x: point.x + dx, y: point.y + dy});
      for (const [id, point] of geometry.positions) positions.set(id, translate(point));
      for (const [id, points] of geometry.routes) routes.set(id, points.map(translate));
    });
    // Reference overlays do not influence the arrangement of subject fact groups.
    for (const edge of graph.edges) {
      if (edge.kind !== 'reference') continue;
      const a = positions.get(edge.source), b = positions.get(edge.target);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const offset = 60;
      routes.set(edge.id, [a, {x: (a.x + b.x) / 2 - dy / length * offset,
        y: (a.y + b.y) / 2 + dx / length * offset}, b]);
    }
    return {positions, routes, width, height, cyclic: false, elapsed: performance.now() - started, settings};
  }
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


// The same module is the worker entry and the main-thread request interface.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({data}) => {
    try { globalThis.postMessage({result: computeLayout(data.graph, data.options)}); }
    catch (error) { globalThis.postMessage({error: error.message}); }
  };
}

let pendingLayout = null;

export function cancelLayout() {
  if (!pendingLayout) return;
  clearTimeout(pendingLayout.timer);
  pendingLayout.worker.terminate();
  pendingLayout.resolve(null);
  pendingLayout = null;
}

/** Run the latest layout in a worker and discard any earlier request. */
export function requestLayout(graph, options) {
  cancelLayout();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./layout.js', import.meta.url), {type: 'module'});
    const finish = (result, error) => {
      if (pendingLayout?.worker !== worker) return;
      clearTimeout(pendingLayout.timer);
      worker.terminate();
      pendingLayout = null;
      if (error) reject(new Error(error)); else resolve(result);
    };
    const timer = setTimeout(() => finish(null, 'Layout took too long. Try two-layer crossing reduction or greedy coordinates.'), 15000);
    pendingLayout = {worker, timer, resolve};
    worker.onmessage = ({data}) => finish(data.result, data.error);
    worker.onerror = event => finish(null, event.message || 'Could not start the layout worker');
    worker.postMessage({graph, options});
  });
}
