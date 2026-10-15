import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLayout, cancelLayout} from '../src/layout.js';

test('new requests cancel old workers, preserve Maps, and report layout errors', async () => {
  const original = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class {
    constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  };
  try {
    const graph = {nodes: [], edges: []};
    const first = requestLayout(graph, {algorithm: 'sugiyama'});
    const second = requestLayout(graph, {algorithm: 'grid'});
    assert.equal(await first, null);
    assert.equal(workers[0].terminated, true);
    assert.equal(workers[1].options.type, 'module');
    const result = {positions: new Map([['a', {x: 1, y: 2}]]), routes: new Map()};
    workers[1].onmessage({data: {result}});
    assert.deepEqual(await second, result);
    assert.equal(workers[1].terminated, true);
    const failed = requestLayout(graph, {});
    workers[2].onmessage({data: {error: 'Too many nodes for optimal crossing reduction'}});
    await assert.rejects(failed, /Too many nodes/);
    const cancelled = requestLayout(graph, {});
    cancelLayout();
    assert.equal(await cancelled, null);
    assert.equal(workers[3].terminated, true);
  } finally {
    cancelLayout();
    if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original;
  }
});
