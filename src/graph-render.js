import {formatValue} from './engine.js';

/** A derived view: fact IDs survive; source assertions are never modified. */
export function createGraph(snapshot, facts, {includeLiterals = false, filtered = false} = {}) {
  const used = new Set();
  const edges = [];
  const literals = [];
  for (const fact of facts) {
    used.add(fact.subjectId);
    if (fact.targetId) used.add(fact.targetId);
    if (!fact.targetId && !includeLiterals) continue;
    const target = fact.targetId ?? JSON.stringify(['literal', fact.id]);
    if (!fact.targetId) literals.push({id: target, label: formatValue(fact.value), kind: 'literal', factId: fact.id});
    edges.push({id: fact.id, factId: fact.id, source: fact.subjectId, target, label: fact.property});
  }
  const nodes = snapshot.subjects.filter(subject => !filtered || used.has(subject.id))
    .map(subject => ({id: subject.id, label: subject.phrase, kind: 'subject'}));
  return {nodes: [...nodes, ...literals], edges};
}

// Connection geometry, picking, and label placement.

/** Canvas commands and sampled geometry share one path for drawing and picking. */
function distinct(points) {
  return points.filter((point, index) => !index || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-6);
}
function trimStart(points, distance) {
  while (points.length > 1) {
    const a = points[0], b = points[1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > distance) {
      return [{x: a.x + (b.x - a.x) * distance / length, y: a.y + (b.y - a.y) * distance / length}, ...points.slice(1)];
    }
    distance -= length; points = points.slice(1);
  }
  return points;
}
export function makePath(input, style = 'curved') {
  const route = distinct(input);
  if (!route.length) return {commands: [], points: []};
  const commands = [['M', route[0].x, route[0].y]];
  const points = [route[0]];
  const line = point => { commands.push(['L', point.x, point.y]); points.push(point); };
  if (style !== 'curved') route.slice(1).forEach(line);
  else {
    for (let index = 1; index < route.length - 1; index++) {
      const a = route[index - 1], corner = route[index], b = route[index + 1];
      const before = Math.hypot(corner.x - a.x, corner.y - a.y);
      const after = Math.hypot(b.x - corner.x, b.y - corner.y);
      const radius = Math.min(40, before * .35, after * .35);
      const start = {x: corner.x + (a.x - corner.x) * radius / before, y: corner.y + (a.y - corner.y) * radius / before};
      const end = {x: corner.x + (b.x - corner.x) * radius / after, y: corner.y + (b.y - corner.y) * radius / after};
      line(start);
      commands.push(['Q', corner.x, corner.y, end.x, end.y]);
      for (let step = 1; step <= 12; step++) {
        const t = step / 12, u = 1 - t;
        points.push({x: u * u * start.x + 2 * u * t * corner.x + t * t * end.x, y: u * u * start.y + 2 * u * t * corner.y + t * t * end.y});
      }
    }
    if (route.length > 1) line(route.at(-1));
  }
  return {commands, points};
}

export function buildEdgePaths(graph, geometry, style) {
  const groups = new Map();
  const nodeKinds = new Map(graph.nodes.map(node => [node.id, node.kind]));
  for (const edge of graph.edges) {
    const key = JSON.stringify([edge.source, edge.target].sort());
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  const paths = new Map();
  for (const group of groups.values()) group.forEach((edge, index) => {
    const start = geometry.positions.get(edge.source), end = geometry.positions.get(edge.target);
    let route = geometry.routes.get(edge.id);
    if (style === 'straight' && edge.source !== edge.target) {
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy) || 1;
      const orientation = edge.source < edge.target ? 1 : -1;
      const offset = (index - (group.length - 1) / 2) * 24 * orientation;
      route = offset ? [start, {x: (start.x + end.x) / 2 - dy / length * offset, y: (start.y + end.y) / 2 + dx / length * offset}, end] : [start, end];
    }
    route = distinct([start, ...route, end]);
    if (route.length > 1) {
      route = trimStart(route, nodeKinds.get(edge.source) === 'literal' ? 6 : 10);
      route = trimStart([...route].reverse(), nodeKinds.get(edge.target) === 'literal' ? 6 : 10).reverse();
    }
    paths.set(edge.id, makePath(route, style));
  });
  return paths;
}

export function strokePath(context, commands) {
  context.beginPath();
  for (const [command, ...values] of commands) {
    if (command === 'M') context.moveTo(...values);
    else if (command === 'L') context.lineTo(...values);
    else context.quadraticCurveTo(...values);
  }
  context.stroke();
}

export function midpoint(points) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] && lengths[index]) {
      const a = points[index], b = points[index + 1], t = remaining / lengths[index];
      return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
    }
    remaining -= lengths[index];
  }
  return points[0];
}

export function distanceToRoute(point, route) {
  let distance = Infinity;
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1], b = route[index];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return distance;
}


const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Try positions along each displayed path, reserving space around nodes and labels. */
export function placeEdgeLabels(items, obstacles, fontSize) {
  const occupied = [...obstacles];
  const labels = [];
  for (const item of items) {
    const center = midpoint(item.points);
    if (!center) continue;
    const segments = item.points.slice(1).map((b, index) => {
      const a = item.points[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const point = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
      return {a, b, length, point, priority: Math.hypot(point.x - center.x, point.y - center.y)};
    }).filter(segment => segment.length > 1).sort((a, b) => a.priority - b.priority || b.length - a.length);
    let found;
    for (const segment of segments) {
      const nx = -(segment.b.y - segment.a.y) / segment.length;
      const ny = (segment.b.x - segment.a.x) / segment.length;
      for (const offset of [fontSize, -fontSize, fontSize * 2.2, -fontSize * 2.2, fontSize * 4, -fontSize * 4]) {
        const x = segment.point.x + nx * offset;
        const y = segment.point.y + ny * offset;
        const box = {x: x - item.width / 2 - 3, y: y - fontSize / 2 - 3, width: item.width + 6, height: fontSize + 6};
        if (!occupied.some(obstacle => overlaps(box, obstacle))) { found = {...item, x, y, box}; break; }
      }
      if (found) break;
    }
    if (found) { occupied.push(found.box); labels.push(found); }
  }
  return labels;
}

// p5 drawing and interaction.

/** p5 draws geometry supplied by the layout. It never owns or edits TN facts. */
export class NetworkRenderer {
  constructor(host, {p5, onSelect}) {
    this.host = host;
    this.onSelect = onSelect;
    this.graph = {nodes: [], edges: []};
    this.geometry = {positions: new Map(), routes: new Map()};
    this.selection = null;
    this.labels = false;
    this.edgeStyle = 'curved';
    this.labelSize = 11;
    this.paths = new Map();
    this.camera = {x: 0, y: 0, zoom: 1};
    this.needsFit = true;
    this.ready = false;
    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'network-canvas';
    host.append(this.canvasHost);
    this.emptyState = host.querySelector('.empty-state');
    this.sketch = new p5(p => {
      this.p = p;
      p.setup = () => {
        const canvas = p.createCanvas(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
        canvas.elt.setAttribute('aria-label', 'Truenumber network. Use the Table view for keyboard inspection of all facts.');
        p.pixelDensity(1);
        p.textFont('system-ui');
        p.noLoop();
        this.ready = true;
        this.resize();
      };
      p.draw = () => this.draw(p);
      const inside = () => !host.hidden && p.mouseX >= 0 && p.mouseY >= 0 && p.mouseX < p.width && p.mouseY < p.height;
      p.mousePressed = () => {
        if (!inside() || !p.mouseButton.left) return;
        this.pan = {x: p.mouseX, y: p.mouseY, camera: {...this.camera}, moved: false};
        return false;
      };
      p.mouseDragged = () => {
        if (!this.pan) return;
        const dx = p.mouseX - this.pan.x, dy = p.mouseY - this.pan.y;
        if (Math.hypot(dx, dy) > 4) this.pan.moved = true;
        this.camera.x = this.pan.camera.x + dx;
        this.camera.y = this.pan.camera.y + dy;
        this.redraw();
        return false;
      };
      p.mouseReleased = () => {
        if (!this.pan) return;
        if (!this.pan.moved && inside()) this.onSelect(this.hit(this.world(p.mouseX, p.mouseY)));
        this.pan = null;
      };
      p.mouseWheel = event => {
        if (!inside()) return;
        const before = this.world(p.mouseX, p.mouseY);
        const zoom = Math.max(.01, Math.min(5, this.camera.zoom * Math.exp(-event.deltaY * .001)));
        this.camera = {zoom, x: p.mouseX - p.width / 2 - before.x * zoom, y: p.mouseY - p.height / 2 - before.y * zoom};
        this.redraw();
        return false;
      };
    }, this.canvasHost);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  world(x, y) {
    return {x: (x - this.p.width / 2 - this.camera.x) / this.camera.zoom, y: (y - this.p.height / 2 - this.camera.y) / this.camera.zoom};
  }

  hit(point) {
    for (const node of [...this.graph.nodes].reverse()) {
      const position = this.geometry.positions.get(node.id);
      if (Math.hypot(point.x - position.x, point.y - position.y) <= Math.max(10, 9 / this.camera.zoom)) {
        return node.factId ? {factId: node.factId} : {subjectId: node.id};
      }
    }
    let closest = null, distance = 6 / this.camera.zoom;
    for (const edge of this.graph.edges) {
      const next = distanceToRoute(point, this.paths.get(edge.id).points);
      if (next < distance) { closest = {factId: edge.factId}; distance = next; }
    }
    return closest;
  }

  setGraph(graph, geometry) {
    this.graph = graph;
    this.geometry = geometry;
    this.paths = buildEdgePaths(graph, geometry, this.edgeStyle);
    this.emptyState.hidden = graph.nodes.length > 0;
    this.fit();
  }

  setAppearance({edgeStyle = this.edgeStyle, labelSize = this.labelSize}) {
    this.edgeStyle = edgeStyle;
    this.labelSize = labelSize;
    this.paths = buildEdgePaths(this.graph, this.geometry, edgeStyle);
    this.redraw();
  }

  setSelection(selection) { this.selection = selection; this.redraw(); }
  setLabels(show) { this.labels = show; this.redraw(); }
  redraw() { if (this.ready) this.p.redraw(); }

  resize() {
    if (!this.ready || !this.host.clientWidth || !this.host.clientHeight) return;
    this.p.resizeCanvas(this.host.clientWidth, this.host.clientHeight, true);
    if (this.needsFit) this.fit();
    else this.redraw();
  }

  fit() {
    if (!this.ready || !this.host.clientWidth) { this.needsFit = true; return; }
    this.needsFit = false;
    const points = [...this.geometry.positions.values(), ...[...this.geometry.routes.values()].flat()];
    if (!points.length) { this.camera = {x: 0, y: 0, zoom: 1}; this.redraw(); return; }
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const zoom = Math.max(.01, Math.min(1.5, Math.max(60, this.host.clientWidth - 100) / (maxX - minX + 180), Math.max(60, this.host.clientHeight - 100) / (maxY - minY + 100)));
    this.camera = {zoom, x: -(minX + maxX) / 2 * zoom, y: -(minY + maxY) / 2 * zoom};
    this.redraw();
  }

  draw(p) {
    p.background('#f6f8fa');
    const zoom = this.camera.zoom;
    p.push();
    p.translate(p.width / 2 + this.camera.x, p.height / 2 + this.camera.y);
    p.scale(zoom);
    const activeEdge = edge => this.selection?.factId === edge.factId || [edge.source, edge.target].includes(this.selection?.subjectId);
    // Draw selected connections last so they remain visible at crossings.
    const edges = [...this.graph.edges].sort((a, b) => Number(activeEdge(a)) - Number(activeEdge(b)));
    for (const edge of edges) {
      const path = this.paths.get(edge.id);
      const route = path.points;
      if (route.length < 2) continue;
      const active = activeEdge(edge);
      const color = active ? '#bd581d' : '#91a3af';
      p.stroke(color); p.strokeWeight((active ? 2.4 : 1) / Math.max(.5, zoom)); p.noFill();
      strokePath(p.drawingContext, path.commands);
      const end = route.at(-1), previous = route.at(-2);
      const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
      p.push(); p.translate(end.x, end.y); p.rotate(angle);
      p.noStroke(); p.fill(color); p.triangle(0, 0, -9, -4, -9, 4); p.pop();

    }
    const fontSize = this.labelSize / Math.max(1, zoom);
    p.textSize(fontSize);
    const obstacles = [];
    for (const node of this.graph.nodes) {
      const position = this.geometry.positions.get(node.id);
      obstacles.push({x: position.x - 13, y: position.y - 13, width: 26, height: 26});
      if (node.kind === 'subject' || zoom > .65 || Boolean(node.factId && node.factId === this.selection?.factId)) {
        p.textSize(10 / Math.max(.45, zoom));
        const label = node.label.length > 34 ? node.label.slice(0, 32) + '…' : node.label;
        obstacles.push({x: position.x + 11, y: position.y - 8 / Math.max(.45, zoom), width: p.textWidth(label) + 5, height: 16 / Math.max(.45, zoom)});
      }
    }
    p.textSize(fontSize);
    const labelItems = [...edges].reverse().filter(edge => (this.labels && zoom > .25) || activeEdge(edge)).map(edge => ({
      edge, points: this.paths.get(edge.id).points, width: p.textWidth(edge.label),
    }));
    p.textAlign(p.CENTER, p.CENTER);
    for (const label of placeEdgeLabels(labelItems, obstacles, fontSize)) {
      p.noStroke(); p.fill('#f6f8fa');
      p.rect(label.box.x, label.box.y, label.box.width, label.box.height, 2);
      p.fill(activeEdge(label.edge) ? '#9e4214' : '#506171');
      p.text(label.edge.label, label.x, label.y);
    }
    const selectedEdge = this.graph.edges.find(edge => edge.factId === this.selection?.factId);
    for (const node of this.graph.nodes) {
      const position = this.geometry.positions.get(node.id);
      const active = this.selection?.subjectId === node.id || Boolean(node.factId && this.selection?.factId === node.factId) || [selectedEdge?.source, selectedEdge?.target].includes(node.id);
      p.stroke(active ? '#bd581d' : '#fff'); p.strokeWeight(active ? 3 : 1.5);
      p.fill(node.kind === 'literal' ? '#b8c4ce' : '#287b83');
      if (node.kind === 'literal') p.rect(position.x - 5, position.y - 5, 10, 10, 2);
      else p.circle(position.x, position.y, 18);
      if (node.kind === 'subject' || zoom > .65 || active) {
        const label = node.label.length > 34 ? node.label.slice(0, 32) + '…' : node.label;
        p.textSize(10 / Math.max(.45, zoom)); p.textAlign(p.LEFT, p.CENTER);
        p.noStroke(); p.fill('#233b49');
        p.text(label, position.x + 13, position.y);
      }
    }
    p.pop();
  }

  destroy() { this.observer.disconnect(); this.sketch.remove(); this.canvasHost.remove(); }
}
