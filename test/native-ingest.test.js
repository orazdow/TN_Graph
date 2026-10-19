import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine, TnParse, groupFacts} from '../src/engine.js';

const record = (value, overrides = {}) => ({_id: 'test', subject: 'bicycle', property: 'description', value, ...overrides});

test('dashboard bike export preserves native metadata and resolves phrase references', () => {
  const records = JSON.parse(readFileSync(new URL('../samples/bike.json', import.meta.url), 'utf8'));
  const engine = new Engine();
  engine.add(records);
  const collection = engine.getCollection();
  assert.equal(collection.facts.length, 28);
  assert.equal(collection.subjects.length, 18);
  assert.equal(collection.facts.filter(f => f.targetId).length, 24);
  assert.equal(collection.facts.filter(f => f.value.type === 'numeric').length, 4);
  for (const [index, fact] of collection.facts.entries()) {
    assert.deepEqual(fact.native, records[index]);
    assert.equal(fact.originalId, records[index]._id);
    assert.equal(fact.statement, records[index].trueStatement);
  }
  records[0].subject = 'changed';
  collection.facts[0].native.subject = 'changed again';
  assert.equal(engine.getCollection().facts[0].subject, 'bicycle');
  assert.notEqual(engine.getCollection().facts[0].native.subject, 'changed again');
});

test('structured fields determine native values independently of display text and HTML', () => {
  const raw = record({type: 'string', value: '41.3 mm', html: '<script>ignored</script>'},
    {trueStatement: 'something else has length = 99 m;'});
  const data = TnParse.parseJson(raw);
  assert.equal(data.facts[0].subject, 'bicycle');
  assert.deepEqual(data.facts[0].value, {type: 'string', text: '41.3 mm'});
  assert.equal(data.facts[0].statement, raw.trueStatement);
  for (const text of ['assembly:frame/fork', '', 'line one\nline two']) {
    assert.deepEqual(TnParse.parseJson(record({type: 'string', value: text})).facts[0].value,
      {type: 'string', text});
  }
});

test('path and readable phrase imports join and count the same assertions', () => {
  const engine = new Engine();
  engine.add(record({type: 'srd', value: 'bicycle/assembly:frame'},
    {subject: 'bicycle/assembly:handlebar', property: 'component:connected', tags: ['revision:design']}));
  engine.add('handlebar assembly of bicycle has connected component = frame assembly of bicycle (design revision);');
  const collection = engine.getCollection();
  assert.equal(collection.subjects.length, 2);
  const grouped = groupFacts(collection.facts);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].occurrenceCount, 2);
  assert.equal(collection.facts[0].targetId, collection.facts[1].targetId);
  assert.equal(TnParse.phrasePath('F-35C aircraft, SN:501662'), 'aircraft:F-35C:SN:501662');
});

test('native and TN numeric tolerances and compound units have matching identities', () => {
  const engine = new Engine();
  const numeric = {type: 'numeric', magnitude: '4.5', tolerance: '.1',
    unitPowers: [{u: 'm', p: 1}, {u: 'sec', p: -2}], quantity: 'acceleration',
    siValue: {magnitude: '4.5'}};
  engine.add(record(numeric, {property: 'acceleration'}));
  engine.add('bicycle has acceleration = 4.5 +/- 0.1 m/sec^2;');
  assert.equal(groupFacts(engine.getCollection().facts)[0].occurrenceCount, 2);
  engine.add(record({...numeric, magnitude: 4.5, tolerance: .2}, {property: 'acceleration'}));
  assert.equal(groupFacts(engine.getCollection().facts).length, 2);
  const dimensionless = TnParse.parseJson(record({type: 'numeric', magnitude: 4,
    unitPowers: [{u: 'unity', p: 1}]}));
  assert.equal(dimensionless.facts[0].value.unit, '');
});

test('legacy JSON and invalid native records are rejected without importing partial data', () => {
  const engine = new Engine();
  const good = record({type: 'string', value: 'blue'});
  engine.add(good);
  const before = engine.getCollection();
  for (const bad of [TnParse.parseStatements('bicycle has color = "blue";'),
    {format: 'synthetic-truenumbers', subjects: [], facts: []},
    [good, record({type: 'string', value: 4}, {_id: 'bad'})],
    [record({type: 'numeric', magnitude: '', unitPowers: [{u: 'm', p: 1}]})],
    [record({type: 'numeric', magnitude: 1, tolerance: -1, unitPowers: [{u: 'm', p: 1}]})],
    [record({type: 'number', value: 4})]]) {
    assert.throws(() => engine.add(bad));
    assert.deepEqual(engine.getCollection(), before);
  }
  assert.throws(() => engine.add([good, record({type: 'srd', value: null}, {_id: 'bad'})]), /Record 2:/);
});
