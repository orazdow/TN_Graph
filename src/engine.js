// engine.js: .json / .tn data ingest and TN filtering rules.
const identity = (...parts) => JSON.stringify(parts);
const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be a nonempty string');
};


// container for parsing utilites for tn and json truenumber input data
// parses to graph-native irepresentation: fact: {subject, property, value, tags}
 
export const TnParse = {
  phrasePath(phrase) {
    requireText(phrase, 'Phrase');
    phrase = phrase.trim();
    const term = '[\\p{L}\\p{N}_-]+';
    if (new RegExp('^' + term + '(?::' + term + ')*(?:/' + term + '(?::' + term + ')*)*$', 'u').test(phrase)) return phrase;
    const segments = phrase.split(/\s+of\s+/).map(segment => {
      const words = segment.split(',').reverse().flatMap(part => part.trim().split(/\s+/).flatMap(word => word.split(':').reverse()));
      if (words.some(word => !/^[\p{L}\p{N}_-]+$/u.test(word))) throw new Error('Unsupported phrase syntax: ' + phrase);
      return words.reverse().join(':');
    });
    return segments.reverse().join('/');
  },

  phraseText(path) {
    return TnParse.phrasePath(path).split('/').reverse().map(part => part.split(':').reverse().join(' ')).join(' of ');
  },

  unitText(powers) {
    if (!Array.isArray(powers) || !powers.length) throw new Error('Numeric value needs unitPowers');
    const units = new Map();
    for (const power of powers) {
      requireText(power?.u, 'Unit');
      if (!Number.isInteger(power.p)) throw new Error('Unit power must be an integer');
      units.set(power.u, (units.get(power.u) ?? 0) + power.p);
    }
    return [...units].filter(([unit, power]) => unit !== 'unity' && power !== 0)
      .map(([unit, power]) => unit + (power === 1 ? '' : '^' + power)).join('*');
  },

  normalizeUnit(unit) {
    if (!unit) return '';
    let sign = 1;
    const powers = [];
    for (const token of unit.trim().replace(/\s+/g, '*').split(/([*/])/)) {
      if (token === '*' || token === '/') { sign = token === '/' ? -1 : 1; continue; }
      const match = token.match(/^([\p{L}µμ°%_]+)(?:\^([+-]?\d+))?$/u);
      if (!match) throw new Error('Unsupported unit expression: ' + unit);
      powers.push({u: match[1], p: Number(match[2] ?? 1) * sign});
    }
    return TnParse.unitText(powers);
  },

  finiteNumber(value, label) {
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) {
      throw new Error(label + ' must be numeric');
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(label + ' must be finite');
    return number;
  },

  // Read native fields directly; trueStatement is retained, not used as the parser.
  parseJson(input) {
    const records = Array.isArray(input) ? input : input?._id ? [input] : null;
    if (!records) throw new Error('Expected native TN JSON: an array of TN records');
    const subjects = new Map(), facts = [], ids = new Set();
    const subjectFor = phrase => {
      const path = TnParse.phrasePath(phrase);
      if (!subjects.has(path)) subjects.set(path, {id: path, path, phrase: TnParse.phraseText(path)});
      return subjects.get(path);
    };
    for (const [index, record] of records.entries()) {
      try {
        requireText(record?._id, 'TN ID');
        if (ids.has(record._id)) throw new Error('Duplicate TN ID: ' + record._id);
        ids.add(record._id);
        const owner = subjectFor(record.subject);
        const propertyPath = TnParse.phrasePath(record.property);
        if (record.tags !== undefined && !Array.isArray(record.tags)) throw new Error('Tags must be an array');
        const tagPaths = [...new Set((record.tags ?? []).map(tag => TnParse.phrasePath(tag)))];
        const raw = record.value;
        let value;
        if (raw?.type === 'srd') {
          const target = subjectFor(raw.value);
          value = {type: 'reference', subject_id: target.id, subject: target.phrase};
        } else if (raw?.type === 'string') {
          if (typeof raw.value !== 'string') throw new Error('String value must contain text');
          value = {type: 'string', text: raw.value};
        } else if (raw?.type === 'numeric') {
          const magnitude = TnParse.finiteNumber(raw.magnitude, 'Magnitude');
          const tolerance = TnParse.finiteNumber(raw.tolerance ?? 0, 'Tolerance');
          if (tolerance < 0) throw new Error('Tolerance must be nonnegative');
          value = {type: 'numeric', magnitude, tolerance, unit: TnParse.unitText(raw.unitPowers)};
          if (raw.quantity !== undefined) { requireText(raw.quantity, 'Quantity'); value.quantity = raw.quantity; }
          if (raw.siValue !== undefined) value.siValue = structuredClone(raw.siValue);
        } else throw new Error('Unsupported native value type: ' + raw?.type);
        const fact = {id: record._id, subject_id: owner.id, subject: owner.phrase,
          property: TnParse.phraseText(propertyPath), propertyPath, value,
          tags: tagPaths.map(path => TnParse.phraseText(path)), tagPaths, native: structuredClone(record)};
        if (record.trueStatement !== undefined) {
          requireText(record.trueStatement, 'Original statement');
          fact.statement = record.trueStatement;
        } else fact.statement = fact.subject + ' has ' + fact.property + ' = ' + formatValue(value) +
          (fact.tags.length ? ' (' + fact.tags.join(', ') + ')' : '') + ';';
        facts.push(fact);
      } catch (error) { throw new Error('Record ' + (index + 1) + ': ' + error.message); }
    }
    return {subjects: [...subjects.values()], facts};
  },

  // Split on semicolons or newlines, keeping quoted text and tags intact.
  statementParts(text) {
    const parts = [];
    let raw = '', quote = '', escaped = false, depth = 0, line = 1, start = 1;
    const finish = () => {
      if (raw.trim()) parts.push({raw: raw.trim(), line: start});
      raw = '';
    };
    for (const character of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')) {
      if (!raw.trim() && !/\s/.test(character)) start = line;
      raw += character;
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '(') depth++;
      else if (character === ')') {
        if (--depth < 0) throw new Error('Line ' + line + ': unexpected closing parenthesis');
      } else if (!depth && (character === ';' || character === '\n')) finish();
      if (character === '\n') line++;
    }
    if (quote || depth) throw new Error('Line ' + start + ': unclosed quote or parentheses');
    finish();
    return parts;
  },

  // Tags after a subject or value apply to the whole fact.
  phraseAndTags(text) {
    let quote = '', escaped = false, opening = -1;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '(') { opening = index; break; }
    }
    if (opening < 0) return {phrase: text.trim(), tags: []};
    const suffix = text.slice(opening);
    if (!/^\([^()]*\)$/.test(suffix)) throw new Error('expected one trailing tag list');
    const tags = suffix.slice(1, -1).split(',').map(tag => tag.trim());
    if (tags.some(tag => !tag)) throw new Error('empty tag');
    return {phrase: text.slice(0, opening).trim(), tags};
  },

  quotedValue(text) {
    const quote = text[0];
    let result = '';
    const escapes = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', '\\': '\\', '"': '"', "'": "'", '/': '/'};
    for (let index = 1; index < text.length; index++) {
      const character = text[index];
      if (character === quote) {
        if (index !== text.length - 1) throw new Error('unexpected text after quoted value');
        return result;
      }
      if (character !== '\\') { result += character; continue; }
      const escaped = text[++index];
      if (escaped === 'u' && /^[\da-f]{4}$/i.test(text.slice(index + 1, index + 5))) {
        result += String.fromCharCode(parseInt(text.slice(index + 1, index + 5), 16));
        index += 4;
      } else if (Object.hasOwn(escapes, escaped)) result += escapes[escaped];
      else throw new Error('unsupported string escape');
    }
    throw new Error('unclosed quoted value');
  },

  // Parse the supported statement forms; phrase values become explicit references.
  parseStatements(text) {
    const subjects = new Map(), facts = [];
    const subjectFor = phrase => {
      const path = TnParse.phrasePath(phrase);
      if (!subjects.has(path)) subjects.set(path, {id: path, path, phrase: TnParse.phraseText(path)});
      return subjects.get(path);
    };
    let previousSubject;
    for (const part of TnParse.statementParts(text)) {
      try {
        const content = part.raw.replace(/;$/, '').trim();
        let subjectText, property, valueText;
        const continuation = content.match(/^and\s+has\s+(.+?)\s*=\s*([\s\S]+)$/);
        const direct = content.match(/^(.+?)\s+has\s+(.+?)\s*=\s*([\s\S]+)$/);
        const inverse = content.match(/^(.+?)\s+of\s+(.+?)\s+is\s+([\s\S]+)$/);
        if (continuation) {
          if (!previousSubject) throw new Error('and has needs a preceding subject');
          subjectText = previousSubject;
          [, property, valueText] = continuation;
        } else if (direct) [, subjectText, property, valueText] = direct;
        else if (inverse) [, property, subjectText, valueText] = inverse;
        else throw new Error('expected subject has property = value');
        const subject = TnParse.phraseAndTags(subjectText.trim());
        const propertyPath = TnParse.phrasePath(property);
        property = TnParse.phraseText(propertyPath);
        if (/^file\s*\(/i.test(valueText)) throw new Error('file values are not supported');
        const parsed = TnParse.phraseAndTags(valueText.trim());
        const rawValue = parsed.phrase;
        requireText(rawValue, 'Value');
        let value;
        if (rawValue[0] === '"' || rawValue[0] === "'") {
          value = {type: 'string', text: TnParse.quotedValue(rawValue)};
        } else {
          if (/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(rawValue)) throw new Error('date values are not supported');
          const number = rawValue.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s*(?:\+\/-|±)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?))?([\s\S]*)$/i);
          if (number) {
            const magnitude = TnParse.finiteNumber(number[1], 'Magnitude');
            const tolerance = TnParse.finiteNumber(number[2] ?? 0, 'Tolerance');
            if (tolerance < 0) throw new Error('Tolerance must be nonnegative');
            value = {type: 'numeric', magnitude, tolerance, unit: TnParse.normalizeUnit(number[3].trim())};
          } else {
            const target = subjectFor(rawValue);
            value = {type: 'reference', subject_id: target.id, subject: target.phrase};
          }
        }
        const owner = subjectFor(subject.phrase);
        const tagPaths = [...new Set([...subject.tags, ...parsed.tags].map(tag => TnParse.phrasePath(tag)))];
        facts.push({id: 'fact-' + (facts.length + 1), subject_id: owner.id, subject: owner.phrase,
          property, propertyPath, value, tags: tagPaths.map(path => TnParse.phraseText(path)), tagPaths, statement: part.raw});
        previousSubject = subject.phrase;
      } catch (error) { throw new Error('Line ' + part.line + ': ' + error.message); }
    }
    if (!facts.length) throw new Error('No TN statements found');
    return {subjects: [...subjects.values()], facts};
  },

  // Public inputs are native JSON records or TN text, never the internal model.
  parseDataset(input, format = 'auto') {
    if (typeof input !== 'string') return TnParse.parseJson(input);
    const text = input.replace(/^\uFEFF/, '').trim();
    if (format === 'json' || (format === 'auto' && /^[{[]/.test(text))) return TnParse.parseJson(JSON.parse(text));
    if (format === 'tn' || format === 'auto') return TnParse.parseStatements(text);
    throw new Error('Unknown input format: ' + format);
  },
};

// Check the graph-native model before storing a parsed source.
export function validateCollection(input) {
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

//  Engine.add(input)   : sparse, validate and store statements as a map 
//   -- TnParse.parseDataset() (chooses.tn or json input format)
//   -- validateCollection()
//  Engine.getCollection()  :  combine source as a model for the graph
export class Engine {
  #sources = new Map();
  #serial = 0;

  add(input, {name = 'Dataset', format = 'auto'} = {}) {
    requireText(name, 'Source name');
    // Validate before storing.
    const data = validateCollection(TnParse.parseDataset(input, format));
    const id = 'source-' + ++this.#serial;
    this.#sources.set(id, {id, name, data});
    return id;
  }

  remove(sourceId) {
    return this.#sources.delete(sourceId);
  }

  // Combine sources by canonical subject path and keep every fact.
  getCollection() {
    const subjects = new Map();
    const facts = [];
    const sources = [];
    for (const source of this.#sources.values()) {
      sources.push({id: source.id, name: source.name, subjects: source.data.subjects.length, facts: source.data.facts.length});
      const localIds = new Map();
      for (const subject of source.data.subjects) {
        const id = identity('subject', subject.path);
        localIds.set(subject.id, id);
        if (!subjects.has(id)) subjects.set(id, {id, path: subject.path, phrase: subject.phrase, contributions: []});
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
  return String(value.magnitude) + (value.tolerance ? ' +/- ' + value.tolerance : '') + (value.unit ? ' ' + value.unit : '');
}

export function selectFacts(snapshot, {query = '', property = '', tag = ''} = {}) {
  const search = query.toLocaleLowerCase();
  return snapshot.facts.filter(fact =>
    (!property || fact.property === property) &&
    (!tag || fact.tags.includes(tag)) &&
    (!search || [fact.subject, fact.property, formatValue(fact.value), ...fact.tags].join(' ').toLocaleLowerCase().includes(search))
  );
}

// Count duplicate facts for display; keep their source occurrences.
export function groupFacts(facts) {
  const groups = new Map();
  for (const fact of facts) {
    const value = fact.value;
    // Optional quantity metadata does not change fact identity.
    const typedValue = value.type === 'reference' ? [value.type, value.subject]
      : value.type === 'numeric' ? [value.type, value.magnitude, value.unit, value.tolerance ?? 0]
      : [value.type, value.text];
    const key = identity(fact.subject, fact.property, typedValue, [...new Set(fact.tags)].sort());
    if (!groups.has(key)) groups.set(key, {...fact, occurrenceCount: 0, occurrences: []});
    const group = groups.get(key);
    group.occurrenceCount++;
    group.occurrences.push(fact);
  }
  return [...groups.values()];
}

// Match table entries by value type and unit as well as content.
export function factFieldKey(fact, field) {
  if (field === 'subject') return fact.subject;
  if (field === 'property') return fact.property;
  const value = fact.value;
  if (value.type === 'reference') return identity(value.type, value.subject);
  if (value.type === 'numeric') return identity(value.type, value.magnitude, value.unit, value.tolerance ?? 0);
  return identity(value.type, value.text);
}

// Match any choice within a column, and require every selected column.
export function matchesTableFilters(fact, selections) {
  return ['subject', 'property', 'value'].every(field =>
    !selections[field].size || selections[field].has(factFieldKey(fact, field)));
}

export function toggleTableFilter(selections, field, key, multiple = false) {
  const next = new Set(multiple ? selections[field] : []);
  if (selections[field].has(key)) {
    if (multiple || selections[field].size === 1) next.delete(key);
    else next.add(key);
  } else next.add(key);
  return {...selections, [field]: next};
}

export function tableColumnEntries(facts, field) {
  const entries = new Map();
  for (const fact of facts) {
    const key = factFieldKey(fact, field);
    if (!entries.has(key)) entries.set(key, {key, label: field === 'value' ? formatValue(fact.value) : fact[field], count: 0});
    entries.get(key).count++;
  }
  return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, {numeric: true}));
}
