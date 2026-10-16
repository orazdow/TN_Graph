import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkRenderer} from '../src/graph-render.js';

test('p5 2 primary-button drag pans; clicks select and secondary buttons do not pan', () => {
  const originalDocument = globalThis.document;
  const originalObserver = globalThis.ResizeObserver;
  globalThis.document = {createElement: () => ({remove() {}})};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  let pointer;
  class P5Stub {
    constructor(sketch) {
      pointer = {width: 800, height: 570, mouseX: 100, mouseY: 100,
        mouseButton: {left: true, right: false, center: false}, remove() {}};
      sketch(pointer);
      return pointer;
    }
  }
  const selected = [];
  const host = {append() {}, querySelector: () => ({hidden: false}), hidden: false};
  let renderer;
  try {
    renderer = new NetworkRenderer(host, {p5: P5Stub, onSelect: value => selected.push(value)});
    renderer.camera = {x: 12, y: 24, zoom: .5};
    pointer.mousePressed();
    pointer.mouseX = 160;
    pointer.mouseY = 130;
    pointer.mouseDragged();
    assert.deepEqual(renderer.camera, {x: 72, y: 54, zoom: .5});
    pointer.mouseReleased();
    assert.equal(renderer.pan, null);
    assert.equal(selected.length, 0, 'a drag must not select on release');
    pointer.mousePressed();
    pointer.mouseReleased();
    assert.deepEqual(selected, [null], 'a plain background click clears selection');
    pointer.mouseButton = {left: false, right: true, center: false};
    pointer.mousePressed();
    assert.equal(renderer.pan, null, 'right button must not start panning');
    const before = {...renderer.camera};
    pointer.mouseX += 50;
    pointer.mouseDragged();
    assert.deepEqual(renderer.camera, before);
  } finally {
    renderer?.destroy();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});

 test('subject and value controls change the sizes used to draw their labels independently', () => {
  const renderer = Object.create(NetworkRenderer.prototype);
  Object.assign(renderer, {
    graph: {nodes: [{id: 's', kind: 'subject', label: 'bolt rear service bay'},
      {id: 'v', kind: 'literal', label: '25 mm'}], edges: []},
    geometry: {positions: new Map([['s', {x: 0, y: 0}], ['v', {x: 100, y: 100}]])},
    camera: {x: 0, y: 0, zoom: 1}, selection: null, paths: new Map(),
    subjectLabelSize: 14, valueLabelSize: 12, propertyLabelSize: 11,
  });
  let size;
  const drawn = new Map();
  const p = {width: 800, height: 600, LEFT: 'left', CENTER: 'center',
    textSize(value) { size = value; }, textWidth(text) { return text.length * size * .6; },
    text(text) { drawn.set(text, size); },
  };
  for (const method of ['background', 'push', 'pop', 'translate', 'scale', 'textAlign',
    'stroke', 'strokeWeight', 'fill', 'rect', 'circle', 'noStroke']) p[method] = () => {};
  renderer.draw(p);
  assert.equal(drawn.get('bolt rear service bay'), 14);
  assert.equal(drawn.get('25 mm'), 12);
  renderer.setAppearance({subjectLabelSize: 26});
  renderer.draw(p);
  assert.equal(drawn.get('bolt rear service bay'), 26);
  assert.equal(drawn.get('25 mm'), 12);
  renderer.setAppearance({valueLabelSize: 20});
  renderer.draw(p);
  assert.equal(drawn.get('bolt rear service bay'), 26);
  assert.equal(drawn.get('25 mm'), 20);
});

test('all label types share fixed-screen or graph-scaled sizing at every zoom', () => {
  const renderer = Object.create(NetworkRenderer.prototype);
  Object.assign(renderer, {
    graph: {nodes: [{id: 's', kind: 'subject', label: 'bolt rear service bay'},
      {id: 'v', kind: 'literal', label: '25 mm'}],
      edges: [{id: 'e', factId: 'f', source: 's', target: 'v', label: 'length'}]},
    geometry: {positions: new Map([['s', {x: 0, y: 0}], ['v', {x: 1000, y: 1000}]])},
    paths: new Map([['e', {points: [{x: 200, y: 400}, {x: 800, y: 400}], commands: []}]]),
    camera: {x: 0, y: 0, zoom: 1}, selection: null, labels: true,
    subjectLabelSize: 14, valueLabelSize: 12, propertyLabelSize: 11,
  });
  let size;
  const drawn = new Map();
  const p = {width: 800, height: 600, LEFT: 'left', CENTER: 'center',
    textSize(value) { size = value; }, textWidth(text) { return text.length * size * .6; },
    text(text) { drawn.set(text, size * renderer.camera.zoom); },
    drawingContext: {beginPath() {}, stroke() {}},
  };
  for (const method of ['background', 'push', 'pop', 'translate', 'scale', 'textAlign',
    'stroke', 'strokeWeight', 'fill', 'rect', 'circle', 'noStroke', 'noFill', 'rotate', 'triangle']) p[method] = () => {};
  for (const scaled of [false, true]) {
    renderer.scaleLabelsWithZoom = scaled;
    for (const zoom of [.1, .5, 1, 2, 5]) {
      renderer.camera.zoom = zoom;
      drawn.clear();
      renderer.draw(p);
      for (const [label, base] of [['bolt rear service bay', 14], ['25 mm', 12], ['length', 11]]) {
        const expected = base * (scaled ? zoom : 1);
        assert.ok(Math.abs(drawn.get(label) - expected) < 1e-9, label + ' at zoom ' + zoom);
      }
    }
  }
});
