const identity = (...parts) => JSON.stringify(parts);
const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be a nonempty string');
};

/** Accept the generator interchange format, not TN sentence text or native TN JSON. */
export function validateDataset(input) {
  if (input?.format !== 'synthetic-truenumbers' || input.format_version !== 1) {
    throw new Error('Expected synthetic-truenumbers JSON with format_version 1');
  }
  if (!Array.isArray(input.subjects) || !Array.isArray(input.facts)) {
    throw new Error('Dataset must contain subjects and facts arrays');
  }
  const data = structuredClone(input);
  const subjects = new Map();
  const factIds = new Set();
  for (const subject of data.subjects) {
    requireText(subject?.id, 'Subject ID');
    requireText(subject.phrase, 'Subject phrase');
    if (subjects.has(subject.id)) throw new Error('Duplicate subject ID: ' + subject.id);
    subjects.set(subject.id, subject.phrase);
  }
  for (const fact of data.facts) {
    requireText(fact?.id, 'Fact ID');
    requireText(fact.property, 'Property');
    if (factIds.has(fact.id)) throw new Error('Duplicate fact ID: ' + fact.id);
    factIds.add(fact.id);
    if (!subjects.has(fact.subject_id) || fact.subject !== subjects.get(fact.subject_id)) {
      throw new Error('Unknown or mismatched subject in ' + fact.id);
    }
    if (!Array.isArray(fact.tags) || fact.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
      throw new Error('Invalid tags in ' + fact.id);
    }
    const value = fact.value;
    if (value?.type === 'reference') {
      if (!subjects.has(value.subject_id) || value.subject !== subjects.get(value.subject_id)) {
        throw new Error('Unknown or mismatched reference in ' + fact.id);
      }
    } else if (value?.type === 'numeric') {
      if (!Number.isFinite(value.magnitude) || typeof value.unit !== 'string') {
        throw new Error('Invalid numeric value in ' + fact.id);
      }
    } else if (value?.type === 'string') {
      if (typeof value.text !== 'string') throw new Error('Invalid string value in ' + fact.id);
    } else {
      throw new Error('Unsupported value type in ' + fact.id);
    }
  }
  return data;
}

/** In-memory assertions. Equal subject phrases merge; every imported fact survives. */
export class Engine {
  #sources = new Map();
  #serial = 0;

  add(input, {name = 'Dataset'} = {}) {
    requireText(name, 'Source name');
    const data = validateDataset(input); // Finish validation before changing the collection.
    const id = 'source-' + ++this.#serial;
    this.#sources.set(id, {id, name, data});
    return id;
  }

  remove(sourceId) {
    return this.#sources.delete(sourceId);
  }

  snapshot() {
    const subjects = new Map();
    const facts = [];
    const sources = [];
    for (const source of this.#sources.values()) {
      sources.push({id: source.id, name: source.name, subjects: source.data.subjects.length, facts: source.data.facts.length});
      const localIds = new Map();
      for (const subject of source.data.subjects) {
        const id = identity('subject', subject.phrase);
        localIds.set(subject.id, id);
        if (!subjects.has(id)) subjects.set(id, {id, phrase: subject.phrase, contributions: []});
        subjects.get(id).contributions.push({sourceId: source.id, originalId: subject.id, metadata: structuredClone(subject)});
      }
      for (const fact of source.data.facts) {
        facts.push({
          ...structuredClone(fact),
          id: identity('fact', source.id, fact.id),
          originalId: fact.id,
          sourceId: source.id,
          sourceName: source.name,
          subjectId: localIds.get(fact.subject_id),
          targetId: fact.value.type === 'reference' ? localIds.get(fact.value.subject_id) : null,
        });
      }
    }
    return {sources, subjects: [...subjects.values()], facts};
  }
}

export function formatValue(value) {
  if (value.type === 'reference') return value.subject;
  if (value.type === 'string') return JSON.stringify(value.text);
  return String(value.magnitude) + (value.unit ? ' ' + value.unit : '');
}

export function selectFacts(snapshot, {query = '', property = '', tag = ''} = {}) {
  const search = query.toLocaleLowerCase();
  return snapshot.facts.filter(fact =>
    (!property || fact.property === property) &&
    (!tag || fact.tags.includes(tag)) &&
    (!search || [fact.subject, fact.property, formatValue(fact.value), ...fact.tags].join(' ').toLocaleLowerCase().includes(search))
  );
}

/** Group equivalent assertions for display while retaining every imported occurrence. */
export function groupFacts(facts) {
  const groups = new Map();
  for (const fact of facts) {
    const value = fact.value;
    const typedValue = value.type === 'reference' ? [value.type, value.subject]
      : value.type === 'numeric' ? [value.type, value.magnitude, value.unit, value.quantity ?? null]
      : [value.type, value.text];
    const key = identity(fact.subject, fact.property, typedValue, [...new Set(fact.tags)].sort());
    if (!groups.has(key)) groups.set(key, {...fact, occurrenceCount: 0, occurrences: []});
    const group = groups.get(key);
    group.occurrenceCount++;
    group.occurrences.push(fact);
  }
  return [...groups.values()];
}
