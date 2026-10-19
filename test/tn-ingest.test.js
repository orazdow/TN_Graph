import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {Engine, TnParse, groupFacts, factFieldKey} from '../src/engine.js';
import {createGraph} from '../src/graph-render.js';

test('every bundled TN file imports the same assertions and references as its JSON companion', () => {
  const directory = new URL('../samples/', import.meta.url);
  const key = fact => JSON.stringify([fact.subject, fact.property, factFieldKey(fact, 'value'), [...fact.tags].sort()]);
  for (const filename of readdirSync(directory, {recursive: true}).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.tn'))) {
    const text = readFileSync(new URL(filename.replaceAll('\\', '/'), directory), 'utf8');
    const json = JSON.parse(readFileSync(new URL(filename.replaceAll('\\', '/').replace(/\.tn$/, '.json'), directory), 'utf8'));
    const native = TnParse.parseJson(json);
    const engine = new Engine();
    engine.add(text, {name: filename, format: 'tn'});
    const parsed = engine.getCollection();
    assert.deepEqual(parsed.facts.map(key).sort(), native.facts.map(key).sort(), filename);
    assert.deepEqual(parsed.subjects.map(s => s.phrase).sort(), native.subjects.map(s => s.phrase).sort(), filename);
    engine.add(json, {name: 'JSON companion'});
    const combined = engine.getCollection();
    const grouped = groupFacts(combined.facts);
    assert.equal(grouped.length, json.length, filename);
    assert.ok(grouped.every(fact => fact.occurrenceCount === 2), filename);
    for (const view of ['references', 'all', 'facts', 'facts-references']) {
      const graph = createGraph(parsed, parsed.facts, {view, includeLiterals: view === 'all'});
      const endpoints = new Set(graph.nodes.map(node => node.id));
      assert.ok(graph.edges.every(edge => endpoints.has(edge.source) && endpoints.has(edge.target)));
    }
  }
});

test('phrase references resolve forward, across imports, and to subjects with no facts', () => {
  const engine = new Engine();
  engine.add('plate has fastener = bolt; bolt has diameter = 12mm; bolt has owner = workshop;');
  let collection = engine.getCollection();
  assert.equal(collection.subjects.length, 3);
  assert.equal(collection.facts[0].targetId, collection.facts[1].subjectId);
  engine.add('workshop has area = 40 m^2;');
  collection = engine.getCollection();
  assert.equal(collection.subjects.length, 3);
  assert.equal(collection.facts[2].targetId, collection.facts[3].subjectId);
  const self = TnParse.parseStatements('shaft has paired shaft = shaft;');
  assert.equal(self.facts[0].subject_id, self.facts[0].value.subject_id);
});

test('quoted strings retain punctuation, escaped quotes, multiline text, and literal-looking contents', () => {
  const text = `item has note = "first; (not a tag), has x = y\nsecond line" (review);
item has status = 'it\\'s ready'; item has code = "41.3 mm";
item has path = "C:\\\\temp"; item has letter = "\\u0041";`;
  const data = TnParse.parseStatements(text);
  assert.equal(data.facts.length, 5);
  assert.equal(data.subjects.length, 1);
  assert.equal(data.facts[0].value.text, 'first; (not a tag), has x = y\nsecond line');
  assert.deepEqual(data.facts[0].tags, ['review']);
  assert.equal(data.facts[1].value.text, "it's ready");
  assert.equal(data.facts[2].value.type, 'string');
  assert.equal(data.facts[3].value.text, 'C:\\temp');
  assert.equal(data.facts[4].value.text, 'A');
  assert.equal(data.facts[0].statement, text.slice(0, text.indexOf('(review);') + '(review);'.length));
});

test('alternate sentence form, subject/value tags, continuation, and optional semicolons', () => {
  const data = TnParse.parseStatements('area of plate west bay (design B) is 38m^2 (west bay)\nplate west bay has length = 4 m; and has mass = 12 kg (measured);');
  assert.equal(data.facts.length, 3);
  assert.equal(data.subjects.length, 1);
  assert.equal(data.facts[0].subject, 'plate west bay');
  assert.equal(data.facts[0].property, 'area');
  assert.deepEqual(data.facts[0].tags, ['design B', 'west bay']);
  assert.equal(data.facts[2].subject, 'plate west bay');
  assert.deepEqual(data.facts[2].tags, ['measured']);
  assert.equal(data.facts[0].value.magnitude, 38);
  assert.equal(data.facts[0].value.unit, 'm^2');
});

test('numbers preserve units and support signs, scientific notation, and dimensionless values', () => {
  const data = TnParse.parseStatements('item has force = -6.28e-7 N; item has ratio = .5; item has torque = +30 N*m;');
  assert.deepEqual(data.facts.map(f => [f.value.magnitude, f.value.unit]), [[-6.28e-7, 'N'], [.5, ''], [30, 'N*m']]);
  assert.equal(TnParse.parseDataset('\uFEFFitem has width = 4 mm;').facts.length, 1);
  const json = JSON.stringify([{_id: 'n1', subject: 'item', property: 'ratio', value: {type: 'numeric', magnitude: '0.5', unitPowers: [{u: 'unity', p: 1}]}}]);
  assert.equal(TnParse.parseDataset('\uFEFF' + json).facts[0].value.magnitude, .5);
  const engine = new Engine();
  engine.add(json, {format: 'json'});
  assert.equal(engine.getCollection().facts.length, 1);
});

test('malformed or unsupported TN input is rejected atomically with a line number', () => {
  const engine = new Engine();
  engine.add('plate has length = 4 m;');
  const before = engine.getCollection();
  for (const invalid of ['not a statement', 'item has mass = ;', 'item has note = "unclosed',
    'item has mass = 4 kg (unclosed', 'item has mass = 4 kg )', 'item has note = "ok" extra;',
    'item has length = 34.5 +/- -0.5 ft;', 'item has date = 2024-05-31;',
    'item has report = file(report);', 'item has mass = 1,000 kg;',
    'item has length = 4 * 10^3 m;', 'item has value = 1e999;', 'item has mass = 4 kg (,tag);']) {
    assert.throws(() => engine.add('other has length = 2m;\n' + invalid), /Line 2:/, invalid);
    assert.deepEqual(engine.getCollection(), before);
  }
  assert.throws(() => TnParse.parseStatements('and has length = 4 m;'), /preceding subject/);
  assert.throws(() => engine.add(' \n\n '), /No TN statements/);
  assert.deepEqual(engine.getCollection(), before);
  assert.throws(() => engine.add('{invalid}', {format: 'json'}));
});
