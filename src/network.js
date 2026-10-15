import {distanceToRoute, buildEdgePaths, strokePath, placeEdgeLabels} from './edge-paths.js';

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
