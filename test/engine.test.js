import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {Engine, TnParse, selectFacts, validateCollection, groupFacts, factFieldKey, matchesTableFilters, toggleTableFilter, tableColumnEntries} from '../src/engine.js';

const fixture = () => [
  {_id: 'f1', subject: 'Aurora:ship', property: 'owner', value: {type: 'srd', value: 'Meridian:company'}, tags: ['verified'], agent: {creatorAgent: {userId: 'reviewer'}}},
  {_id: 'f2', subject: 'Aurora:ship', property: 'mass', value: {type: 'numeric', magnitude: '1200', unitPowers: [{u: 'tonnes', p: 1}], quantity: 'mass'}, tags: []},
  {_id: 'f3', subject: 'Meridian:company', property: 'status', value: {type: 'string', value: 'active'}, tags: ['verified']},
];

test('imports namespace facts, merge exact phrases, preserve conflicts and provenance', () => {
  const engine = new Engine();
  const first = engine.add(fixture(), {name: 'A'});
  const conflicting = fixture();
  conflicting[1].value.magnitude = '1300';
  const second = engine.add(conflicting, {name: 'B'});
  const snapshot = engine.getCollection();
  assert.equal(snapshot.subjects.length, 2);
  assert.equal(snapshot.facts.length, 6);
  assert.equal(new Set(snapshot.facts.map(f => f.id)).size, 6);
  assert.deepEqual(snapshot.facts.filter(f => f.property === 'mass').map(f => f.value.magnitude), [1200, 1300]);
  assert.equal(snapshot.facts[0].targetId, snapshot.subjects[1].id);
  assert.equal(snapshot.facts[0].sourceId, first);
  assert.equal(snapshot.facts[3].sourceId, second);
  assert.equal(snapshot.facts[0].originalId, 'f1');
  assert.equal(snapshot.facts[0].native.agent.creatorAgent.userId, 'reviewer');
});

test('source removal retains shared subjects and stable remaining identities', () => {
  const engine = new Engine();
  const first = engine.add(fixture());
  const second = engine.add(fixture());
  const before = engine.getCollection();
  engine.remove(first);
  const after = engine.getCollection();
  assert.deepEqual(after.subjects.map(s => s.id), before.subjects.map(s => s.id));
  assert.deepEqual(after.facts.map(f => f.id), before.facts.filter(f => f.sourceId === second).map(f => f.id));
  engine.remove(second);
  assert.deepEqual(engine.getCollection(), {subjects: [], facts: [], sources: []});
});

test('invalid native imports are atomic and reject unsupported types, IDs and values', () => {
  const engine = new Engine();
  engine.add(fixture());
  const before = engine.getCollection();
  for (const mutate of [
    data => { data[0]._id = ''; },
    data => { data.push(data[0]); },
    data => { data[0].value.value = null; },
    data => { data[0].subject = ''; },
    data => { data[1].value.magnitude = Infinity; },
    data => { data[1].value.type = 'date'; },
    data => { data[1].value.unitPowers = [{u: 'kg', p: 1.5}]; },
    data => { data[0].tags = [null]; },
  ]) {
    const bad = fixture(); mutate(bad);
    assert.throws(() => engine.add(bad));
    assert.deepEqual(engine.getCollection(), before);
  }
  assert.throws(() => engine.add(fixture(), {name: ''}));
  assert.deepEqual(engine.getCollection(), before);
});

test('input and snapshot mutations do not change stored facts or metadata', () => {
  const engine = new Engine();
  const input = fixture(); engine.add(input);
  input[0].tags.push('external');
  input[0].agent.creatorAgent.userId = 'changed';
  const snapshot = engine.getCollection();
  snapshot.facts[0].tags.push('snapshot change');
  snapshot.facts[0].native.agent.creatorAgent.userId = 'snapshot change';
  assert.deepEqual(engine.getCollection().facts[0].tags, ['verified']);
  assert.equal(engine.getCollection().facts[0].native.agent.creatorAgent.userId, 'reviewer');
});

test('query, exact property, and exact tag filters combine without changing collection', () => {
  const engine = new Engine(); engine.add(fixture());
  const snapshot = engine.getCollection();
  assert.equal(selectFacts(snapshot, {query: 'MERIDIAN', property: 'owner', tag: 'verified'}).length, 1);
  assert.equal(selectFacts(snapshot, {query: '1200 tonnes'})[0].property, 'mass');
  assert.equal(selectFacts(snapshot, {property: 'own'}).length, 0);
  assert.equal(selectFacts(snapshot, {tag: 'ver'}).length, 0);
  assert.equal(selectFacts(snapshot, {query: 'missing'}).length, 0);
  assert.equal(engine.getCollection().facts.length, 3);
});

test('all bundled generator samples validate and import', () => {
  const directory = new URL('../samples/', import.meta.url);
  for (const filename of readdirSync(directory, {recursive: true}).map(name => name.replaceAll('\\', '/')).filter(name => /^(construction|navy)\/.*\.json$/.test(name))) {
    const data = JSON.parse(readFileSync(new URL(filename, directory), 'utf8'));
    const parsed = validateCollection(TnParse.parseJson(data));
    const engine = new Engine(); engine.add(data);
    assert.equal(engine.getCollection().facts.length, data.length);
    assert.equal(engine.getCollection().subjects.length, parsed.subjects.length);
  }
});

test('display grouping counts repeated imports across local IDs and preserves source removal', () => {
  const engine = new Engine();
  const first = engine.add(fixture(), {name: 'First'});
  const second = engine.add(fixture(), {name: 'Second'});
  const raw = engine.getCollection(), before = structuredClone(raw);
  const grouped = groupFacts(raw.facts);
  assert.equal(grouped.length, 3);
  assert.ok(grouped.every(fact => fact.occurrenceCount === 2));
  assert.ok(grouped.every(fact => fact.occurrences.length === 2));
  assert.deepEqual(grouped[0].occurrences.map(fact => fact.sourceId), [first, second]);
  assert.deepEqual(raw, before, 'grouping must not mutate imported assertions');
  engine.remove(first);
  const remaining = groupFacts(engine.getCollection().facts);
  assert.equal(remaining.length, 3);
  assert.ok(remaining.every(fact => fact.occurrenceCount === 1 && fact.sourceId === second));
  engine.remove(second);
  assert.deepEqual(groupFacts(engine.getCollection().facts), []);
});

test('display grouping compares typed values and tag sets without merging different facts', () => {
  const engine = new Engine(); engine.add(fixture());
  const fact = engine.getCollection().facts[1];
  const same = {...structuredClone(fact), id: 'different-id', subject_id: 'another-local-id'};
  assert.equal(groupFacts([fact, same])[0].occurrenceCount, 2);
  const tagged = {...fact, tags: ['B', 'A']};
  assert.equal(groupFacts([tagged, {...tagged, tags: ['A', 'B']}]).length, 1);
  for (const different of [
    {...fact, subject: 'another subject'}, {...fact, property: 'weight'},
    {...fact, tags: ['new tag']},
    {...fact, value: {...fact.value, magnitude: 1300}},
    {...fact, value: {...fact.value, unit: 'kg'}},
    {...fact, value: {type: 'string', text: '1200 tonnes'}},
  ]) assert.equal(groupFacts([fact, different]).length, 2);
});

test('table selections use OR within columns, AND across columns, and compose with existing filters', () => {
  const engine = new Engine(); engine.add(fixture());
  const snapshot = engine.getCollection();
  const [owner, mass, status] = snapshot.facts;
  let selections = {subject: new Set(), property: new Set(), value: new Set()};
  const matching = () => snapshot.facts.filter(fact => matchesTableFilters(fact, selections));
  assert.equal(matching().length, 3);
  selections = toggleTableFilter(selections, 'subject', owner.subject);
  assert.deepEqual(matching(), [owner, mass]);
  selections = toggleTableFilter(selections, 'subject', status.subject, true);
  assert.equal(matching().length, 3);
  selections = toggleTableFilter(selections, 'property', 'mass');
  assert.deepEqual(matching(), [mass]);
  selections = toggleTableFilter(selections, 'property', 'owner', true);
  assert.deepEqual(matching(), [owner, mass]);
  assert.deepEqual(selectFacts(snapshot, {tag: 'verified'}).filter(fact => matchesTableFilters(fact, selections)), [owner]);
  selections = toggleTableFilter(selections, 'property', 'mass', true);
  assert.deepEqual(matching(), [owner]);
  selections = toggleTableFilter(selections, 'subject', owner.subject);
  assert.equal(selections.subject.size, 1, 'plain click replaces multi-selection in its column');
  selections = toggleTableFilter(selections, 'subject', owner.subject);
  assert.equal(selections.subject.size, 0, 'click the only selected choice to clear');
  selections = toggleTableFilter(selections, 'value', factFieldKey(mass, 'value'));
  assert.equal(matching().length, 0, 'incompatible column filters can yield zero matches');
});

test('value column selection distinguishes units, types and reference targets', () => {
  const engine = new Engine(); engine.add(fixture());
  const [reference, number] = engine.getCollection().facts;
  const key = factFieldKey(number, 'value');
  const selections = {subject: new Set(), property: new Set(), value: new Set([key])};
  assert.ok(matchesTableFilters(number, selections));
  assert.ok(!matchesTableFilters({...number, value: {...number.value, unit: 'kg'}}, selections));
  assert.ok(!matchesTableFilters({...number, value: {type: 'string', text: '1200 tonnes'}}, selections));
  assert.notEqual(factFieldKey(reference, 'value'), factFieldKey({...reference, value: {...reference.value, subject: 'other company'}}, 'value'));
});

test('column browsing lists distinct subjects, properties and typed values with fact counts', () => {
  const engine = new Engine(); engine.add(fixture());
  const facts = engine.getCollection().facts;
  const subjects = tableColumnEntries(facts, 'subject');
  assert.deepEqual(subjects.map(entry => [entry.label, entry.count]), [['company Meridian', 1], ['ship Aurora', 2]]);
  assert.deepEqual(tableColumnEntries(facts, 'property').map(entry => entry.label), ['mass', 'owner', 'status']);
  const mass = facts.find(fact => fact.property === 'mass');
  const entries = tableColumnEntries([mass, {...mass, id: 'copy'}, {...mass, value: {...mass.value, unit: 'kg'}}], 'value');
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.label === '1200 tonnes').count, 2);
  assert.equal(entries.find(entry => entry.label === '1200 kg').count, 1);
  assert.deepEqual(tableColumnEntries([], 'subject'), []);
});
