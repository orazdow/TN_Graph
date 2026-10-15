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
