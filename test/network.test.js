import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkRenderer} from '../src/network.js';

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
