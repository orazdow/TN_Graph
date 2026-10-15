#!/usr/bin/env python3
"""Synthetic Truenumber networks. Python 3.10+, standard library only.

CLI: python generate_tns.py 500 --structure 1 --output demo
API: data = generate(Config(facts=500), seed=12345)

See README.md for precise control semantics and output format. JSON is a
visualization-friendly interchange format, not the TN service's internal JSON.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
import json
import math
from pathlib import Path
import random
import secrets
import sys

PRESETS = {
    0: ('mixed', 'Clusters, hub spokes, chains, and a directed cycle'),
    1: ('clusters', 'Dense local neighborhoods with occasional bridges'),
    2: ('hubs', 'Many subjects referencing a few common targets'),
    3: ('chains', 'Directed sequences with a few shortcuts'),
    4: ('cycles', 'Directed rings with a few additional links'),
    5: ('islands', 'Separate clusters plus reference-isolated subjects'),
}

@dataclass(frozen=True)
class Config:
    facts: int
    subjects: int | None = None
    connectivity: float = 0.45
    sharing: float = 0.60
    structure: int = 0
    property_overlap: float = 0.65
    tag_overlap: float = 0.60
    literal_reuse: float = 0.25


def validate(config: Config) -> int:
    if isinstance(config.facts, bool) or not isinstance(config.facts, int) or config.facts < 1:
        raise ValueError('facts must be a positive integer')
    n = config.subjects
    if n is None:
        n = min(config.facts, max(2, config.facts // 4))
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= config.facts:
        raise ValueError('subjects must be an integer between 1 and facts; every subject gets a fact')
    if isinstance(config.structure, bool) or config.structure not in PRESETS:
        raise ValueError('structure must be a preset integer from 0 to 5')
    for name in ('connectivity', 'sharing', 'property_overlap', 'tag_overlap', 'literal_reuse'):
        value = getattr(config, name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError(f'{name} must be a finite number from 0 to 1')
    if n == 1 and round(config.facts * config.connectivity):
        raise ValueError('reference facts require at least two subjects; use connectivity=0 for one subject')
    return n


def load_vocabulary(path: str | Path | None = None) -> dict:
    path = Path(path) if path else Path(__file__).with_name('tn_vocabulary.json')
    return json.loads(path.read_text(encoding='utf-8'))


def selected_pool(items, overlap, rng):
    """High overlap yields a small shared pool; low overlap uses the full pool."""
    items = list(dict.fromkeys(items))
    if not items:
        raise ValueError('empty vocabulary pool')
    k = 1 + round((1 - overlap) * (len(items) - 1))
    return rng.sample(items, k)


def build_topology(n, count, literal_count, config, rng):
    """Allocate exact reference count. Motifs take priority; filler follows preset."""
    order = list(range(n))
    rng.shuffle(order)
    # An isolated subject still needs one literal fact. Never overpromise isolates.
    isolated_count = min(max(1, round(n * .15)), literal_count, max(0, n - 2)) if config.structure == 5 else 0
    isolated = set(order[:isolated_count])
    active = order[isolated_count:]
    group_count = max(1, min(round(math.sqrt(len(active) / 2)), len(active) // 2))
    groups = [active[i::group_count] for i in range(group_count)]
    membership = {s: g for g, members in enumerate(groups) for s in members}
    hubs = [members[0] for members in groups]
    edges = []
    seen_pairs = set()
    covered = set()
    motif_count = 0

    def add(source, target, motif=False):
        nonlocal motif_count
        if len(edges) >= count or source == target:
            return
        if motif and (source, target) in seen_pairs:
            return
        edges.append((source, target))
        seen_pairs.add((source, target))
        covered.add(source)
        motif_count += int(motif)

    # Build at most one outgoing scaffold edge per active subject first.
    # If references are scarce, remaining subjects receive literal facts later.
    for group_index, members in enumerate(groups if config.structure in (0, 1, 5) else [active]):
        mode = config.structure
        if mode == 0:
            mode = (2, 3, 4)[group_index % 3]
        for i, source in enumerate(members):
            if len(members) < 2:
                break
            target = members[0] if mode == 2 and i else members[(i + 1) % len(members)]
            if mode == 3 and i == len(members) - 1:
                continue
            add(source, target, True)

    # Reserve enough distinct source subjects that literals can cover all others.
    needed_sources = max(0, n - literal_count)
    for source in active:
        if len(covered) >= needed_sources:
            break
        if source not in covered:
            target = active[(active.index(source) + 1) % len(active)]
            add(source, target, True)

    target_hits = Counter(t for _, t in edges)
    positions = {s: i for i, s in enumerate(active)}
    favorites = {id(c): sorted(c, key=lambda x: (-target_hits[x], x))[:max(1, len(c) // 8)]
                 for c in [active] + groups}
    while len(edges) < count:
        if config.structure == 3 and literal_count:
            # Leave the chain's terminal subject for a literal fact. All links
            # point forward, preserving a genuine DAG when the budget permits.
            source_index = rng.randrange(len(active) - 1)
            source = active[source_index]
            if rng.random() < .88:
                target = active[source_index + 1]
            elif rng.random() < config.sharing:
                target = active[-1]
            else:
                target = active[rng.randrange(source_index + 1, len(active))]
            add(source, target)
            target_hits[target] += 1
            continue
        source = rng.choice(active)
        group = groups[membership[source]]
        if config.structure == 5 or (config.structure in (0, 1) and rng.random() < .90):
            candidates = group
        else:
            candidates = active
        # Candidate groups have at least two members by construction.
        if config.structure == 3 and rng.random() < .88:
            target = active[(positions[source] + 1) % len(active)]
        elif config.structure == 4 and rng.random() < .92:
            target = active[(positions[source] + 1) % len(active)]
        else:
            # A mixture of uniform and concentrated target choice implements sharing.
            if rng.random() < config.sharing:
                if config.structure == 2:
                    favored = hubs
                else:
                    favored = favorites[id(candidates)]
                target = rng.choice(favored)
            else:
                target = rng.choice(candidates)
            if target == source:
                pos = candidates.index(source) if source in candidates else 0
                target = candidates[(pos + 1) % len(candidates)]
        add(source, target)
        target_hits[target] += 1
    return edges, isolated, membership, motif_count


# Generic relationships remain meaningful even for deliberately heterogeneous graphs.
RELATIONSHIPS = ['connected item', 'dependency', 'related item', 'shared resource',
                 'linked item', 'reference item', 'associated item', 'backup resource',
                 'upstream item', 'downstream item', 'peer', 'supporting item']

# Base magnitudes use the FIRST unit in each vocabulary group. These are synthetic
# engineering ranges, not realistic bounds for every subject type.
BASE_RANGES = {
    'mass': (.01, 1e5), 'length': (.001, 1e3), 'area': (.0001, 1e4),
    'volume': (.0001, 1e4), 'speed': (.1, 100), 'acceleration': (.01, 100),
    'absolute_temperature': (250, 400), 'pressure': (1e3, 1e7),
    'volumetric_flow_rate': (.00001, 10), 'mass_flow_rate': (.001, 1000),
    'voltage': (.01, 1e4), 'electric_current': (.0001, 1000),
    'electric_resistance': (.01, 1e6), 'power': (.1, 1e7),
    'frequency': (1, 1e10), 'energy': (1, 1e9), 'electric_charge': (1, 1e6),
    'capacitance': (1e-12, .01), 'force': (1, 1e7), 'duration': (1, 1e8),
    'currency_usd': (1, 1e7), 'dimensionless': (0, 1), 'count': (1, 1000),
}


def make_literal(prop, vocabulary, rng):
    quantities = vocabulary['property_quantity_map']
    if prop in quantities:
        quantity = quantities[prop]
        units = vocabulary['units_by_quantity'][quantity]
        low, high = BASE_RANGES.get(quantity, (1, 100))
        if quantity == 'count':
            magnitude = rng.randint(int(low), int(high))
        elif quantity in ('dimensionless', 'absolute_temperature'):
            magnitude = round(rng.uniform(low, high), 4)
        else:
            magnitude = float(f'{10 ** rng.uniform(math.log10(low), math.log10(high)):.5g}')
        return {'type': 'numeric', 'magnitude': magnitude, 'unit': units[0], 'quantity': quantity}
    values = vocabulary['string_value_terms'].get(prop)
    if values is None and prop == 'material':
        values = vocabulary['subject_terms']['materials']
    return {'type': 'string', 'text': rng.choice(values or ['standard', 'experimental', 'replacement'])}


def value_text(value):
    if value['type'] == 'reference':
        return value['subject']
    if value['type'] == 'string':
        return json.dumps(value['text'], ensure_ascii=True)
    return f"{value['magnitude']:.15g}" + (f" {value['unit']}" if value['unit'] else '')


def statement(fact):
    tags = ' (' + ', '.join(fact['tags']) + ')' if fact['tags'] else ''
    return f"{fact['subject']} has {fact['property']} = {value_text(fact['value'])}{tags};"


def graph_statistics(subjects, facts):
    ids = [s['id'] for s in subjects]
    adjacency = {s: set() for s in ids}
    directed = {s: set() for s in ids}
    indegree = Counter()
    incoming_subjects = defaultdict(set)
    references = [f for f in facts if f['value']['type'] == 'reference']
    for f in references:
        s, t = f['subject_id'], f['value']['subject_id']
        adjacency[s].add(t)
        adjacency[t].add(s)
        directed[s].add(t)
        incoming_subjects[t].add(s)
        indegree[t] += 1
    unseen = set(ids)
    components = []
    while unseen:
        start = min(unseen)
        unseen.remove(start)
        queue = [start]
        size = 0
        while queue:
            s = queue.pop()
            size += 1
            for t in adjacency[s]:
                if t in unseen:
                    unseen.remove(t)
                    queue.append(t)
        components.append(size)
    # Kahn's algorithm detects directed cycles without recursion depth limits.
    dag_indegree = Counter(t for neighbors in directed.values() for t in neighbors)
    queue = [s for s in ids if not dag_indegree[s]]
    visited = 0
    while queue:
        s = queue.pop()
        visited += 1
        for t in directed[s]:
            dag_indegree[t] -= 1
            if dag_indegree[t] == 0:
                queue.append(t)
    properties = defaultdict(set)
    tags = defaultdict(set)
    literal_values = []
    for f in facts:
        properties[f['property']].add(f['subject_id'])
        for tag in f['tags']:
            tags[tag].add(f['subject_id'])
        if f['value']['type'] != 'reference':
            literal_values.append((f['property'], json.dumps(f['value'], sort_keys=True)))
    top = sorted(indegree.items(), key=lambda x: (-x[1], x[0]))[:5]
    return {
        'subject_count': len(subjects), 'fact_count': len(facts),
        'reference_fact_count': len(references), 'literal_fact_count': len(literal_values),
        'reference_fraction': len(references) / len(facts),
        'distinct_directed_subject_pairs': sum(map(len, directed.values())),
        'weak_component_sizes': sorted(components, reverse=True),
        'reference_isolated_subjects': sum(not neighbors for neighbors in adjacency.values()),
        'has_directed_cycle': visited != len(ids),
        'distinct_properties': len(properties), 'distinct_tags': len(tags),
        'distinct_semantic_tags': sum(not t.startswith('observation ') for t in tags),
        'subjects_per_property': {p: len(s) for p, s in sorted(properties.items())},
        'subjects_per_tag': {t: len(s) for t, s in sorted(tags.items())},
        'repeated_literal_fraction': 1 - len(set(literal_values)) / len(literal_values) if literal_values else 0,
        'top_reference_targets': [
            {'subject_id': s, 'incoming_facts': c, 'distinct_source_subjects': len(incoming_subjects[s])}
            for s, c in top
        ],
    }


def generate(config: Config, *, seed: int | None = None, vocabulary: dict | None = None) -> dict:
    n = validate(config)
    seed = secrets.randbits(64) if seed is None else seed
    rng = random.Random(seed)
    vocabulary = load_vocabulary() if vocabulary is None else vocabulary
    reference_count = round(config.facts * config.connectivity)
    literal_count = config.facts - reference_count
    edges, isolated, groups, scaffold_count = build_topology(n, reference_count, literal_count, config, rng)
    terms = [(category, term) for category, words in vocabulary['subject_terms'].items()
             if category != 'materials' for term in words]
    names = vocabulary['reference_names']['names']
    subjects = []
    for i in range(n):
        category, term = rng.choice(terms)
        subjects.append({'id': f'S{i + 1:05d}', 'phrase': f'{term} {rng.choice(names)}-{i + 1:05d}',
                         'category': category, 'cluster': groups.get(i),
                         'reserved_isolate': i in isolated})
    relationship_pool = selected_pool(RELATIONSHIPS, config.property_overlap, rng)
    # Exclude ambiguous numeric properties until a quantity has been chosen explicitly.
    literal_pool = selected_pool(list(vocabulary['property_quantity_map']) +
                                 ['status', 'condition', 'priority', 'color', 'material'],
                                 config.property_overlap, rng)
    tag_candidates = [tag for words in vocabulary['tag_terms'].values() for tag in words]
    tag_pool = selected_pool(tag_candidates, config.tag_overlap, rng)
    facts = []
    used_subjects = set()
    seen_statements = set()
    duplicate_annotations = 0

    def append(source, prop, value):
        nonlocal duplicate_annotations
        subject = subjects[source]
        # About 75% of facts receive one or two semantic tags.
        tags = rng.sample(tag_pool, min(len(tag_pool), rng.randint(1, 2))) if rng.random() < .75 else []
        tags.sort()
        f = {'id': f'TN{len(facts) + 1:07d}', 'subject_id': subject['id'],
             'subject': subject['phrase'], 'property': prop, 'value': value, 'tags': tags}
        text = statement(f)
        if text in seen_statements:
            # Keep repeated observations distinct for TN stores that deduplicate facts.
            tags.append(f'observation {len(facts) + 1:07d}')
            duplicate_annotations += 1
            text = statement(f)
        f['statement'] = text
        seen_statements.add(text)
        facts.append(f)
        used_subjects.add(source)

    for source, target in edges:
        append(source, rng.choice(relationship_pool), {'type': 'reference',
               'subject_id': subjects[target]['id'], 'subject': subjects[target]['phrase']})
    missing = [i for i in range(n) if i not in used_subjects]
    if len(missing) > literal_count:
        raise RuntimeError('internal allocation error: insufficient literal slots')
    literal_sources = missing + [rng.randrange(n) for _ in range(literal_count - len(missing))]
    rng.shuffle(literal_sources)
    reused_values = defaultdict(list)
    reuse_events = 0
    for source in literal_sources:
        prop = rng.choice(literal_pool)
        if reused_values[prop] and rng.random() < config.literal_reuse:
            value = dict(rng.choice(reused_values[prop]))
            reuse_events += 1
        else:
            value = make_literal(prop, vocabulary, rng)
            reused_values[prop].append(value)
        append(source, prop, value)
    rng.shuffle(facts)
    settings = asdict(config)
    settings['subjects'] = n
    stats = graph_statistics(subjects, facts)
    stats['deliberate_literal_reuse_events'] = reuse_events
    stats['duplicate_observation_tags'] = duplicate_annotations
    notes = []
    if reference_count < n:
        notes.append('The reference budget is smaller than the subject count; topology motifs may be partial.')
    if config.structure == 3 and literal_count == 0:
        notes.append('With no literal facts every subject needs an outgoing reference, so the chain must close into a cycle.')
    if config.structure == 5 and not isolated:
        notes.append('The subject or literal budget left no room for reserved isolates.')
    if duplicate_annotations:
        notes.append('Repeated statements received observation tags; these are counted separately from semantic tags.')
    return {'format': 'synthetic-truenumbers', 'format_version': 1, 'notes': notes,
            'seed': seed, 'settings': settings,
            'preset': {'id': config.structure, 'name': PRESETS[config.structure][0]},
            'generation': {'scaffold_reference_facts': scaffold_count,
                           'requested_reserved_isolates': len(isolated),
                           'relationship_pool': relationship_pool, 'literal_property_pool': literal_pool,
                           'semantic_tag_pool': tag_pool},
            'statistics': stats, 'subjects': subjects, 'facts': facts}


def write_dataset(data, prefix):
    prefix = Path(prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = Path(str(prefix) + '.json')
    text_path = Path(str(prefix) + '.tn')
    json_path.write_text(json.dumps(data, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')
    text_path.write_text('\n'.join(f['statement'] for f in data['facts']) + '\n', encoding='utf-8')
    return json_path, text_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                     epilog='Presets:\n' + '\n'.join(f'  {i}: {name} -- {desc}' for i, (name, desc) in PRESETS.items()))
    parser.add_argument('facts', type=int, help='required total number of TNs')
    parser.add_argument('--subjects', type=int, default=None, help='default: facts/4, bounded to [1, facts]')
    parser.add_argument('--connectivity', type=float, default=.45, help='reference fact fraction, 0..1 (default .45)')
    parser.add_argument('--sharing', type=float, default=.60, help='target concentration, 0..1 (default .60)')
    parser.add_argument('--structure', type=int, choices=PRESETS, default=0, help='network preset (default 0)')
    parser.add_argument('--property-overlap', type=float, default=.65, help='smaller property pools at higher values (default .65)')
    parser.add_argument('--tag-overlap', type=float, default=.60, help='smaller tag pools at higher values (default .60)')
    parser.add_argument('--literal-reuse', type=float, default=.25, help='chance of copying a previous compatible literal (default .25)')
    parser.add_argument('--output', default='synthetic_tns', help='output path prefix; writes .tn and .json')
    parser.add_argument('--vocabulary', type=Path, help='alternative vocabulary JSON')
    args = parser.parse_args(argv)
    config = Config(**{key: getattr(args, key) for key in Config.__dataclass_fields__})
    try:
        data = generate(config, vocabulary=load_vocabulary(args.vocabulary))
        paths = write_dataset(data, args.output)
    except (ValueError, KeyError, OSError) as exc:
        parser.exit(2, f'error: {exc}\n')
    stats = data['statistics']
    print(f"{stats['fact_count']} facts, {stats['subject_count']} subjects, "
          f"{stats['reference_fact_count']} references, {len(stats['weak_component_sizes'])} components")
    print(f"Preset: {data['preset']['name']}; seed: {data['seed']}")
    for path in paths:
        print(path)


if __name__ == '__main__':
    main()
