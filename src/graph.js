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
