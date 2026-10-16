"""Regenerate curated navy examples from tn_vocabulary_navy.json."""
import json
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parent
DESTINATION = ROOT.parent / 'samples' / 'navy'

def main():
    corpus = json.loads((ROOT / 'tn_vocabulary_navy.json').read_text(encoding='utf-8'))
    DESTINATION.mkdir(parents=True, exist_ok=True)
    summary = []
    for sample, count, minimal in [('navy-smallest', 1, True), ('navy-small', 1, False), ('navy-fleet', 3, False)]:
        rng = random.Random(corpus['seed'])
        subjects, facts = [], []
        phrases = {}
        def subject(identifier, phrase, category):
            subjects.append(dict(id=identifier, phrase=phrase, category=category))
            phrases[identifier] = phrase
        def fact(source, prop, value, tags):
            if value['type'] == 'reference':
                text = value['subject']
            elif value['type'] == 'string':
                text = json.dumps(value['text'])
            else:
                text = str(value['magnitude']) + (' ' + value['unit'] if value['unit'] else '')
            statement = phrases[source] + ' has ' + prop + ' = ' + text
            if tags:
                statement += ' (' + ', '.join(tags) + ')'
            facts.append(dict(id='fact-' + str(len(facts) + 1), subject_id=source, subject=phrases[source],
                              property=prop, value=value, tags=tags, statement=statement + ';'))
        def reference(source, prop, target, tags):
            fact(source, prop, dict(type='reference', subject_id=target, subject=phrases[target]), tags)
        kinds = ['vessel', 'engine', 'shaft'] if minimal else list(corpus['equipment'])
        for name in corpus['vessels'][:count]:
            for kind in kinds:
                spec = corpus['equipment'][kind]
                subject(name + ':' + kind, spec['phrase'].format(name=name), kind)
        for name in corpus['vessels'][:count]:
            tags = [name, *corpus['tags']]
            for kind in kinds:
                spec = corpus['equipment'][kind]
                for prop, measurement in spec['measurements'].items():
                    magnitude = round(rng.uniform(measurement['min'], measurement['max']), measurement['decimals'])
                    if measurement['decimals'] == 0:
                        magnitude = int(magnitude)
                    fact(name + ':' + kind, prop, dict(type='numeric', magnitude=magnitude,
                         unit=measurement['unit'], quantity=measurement['quantity']), tags)
            for source, prop, target in corpus['relationships']:
                if source in kinds and target in kinds:
                    reference(name + ':' + source, prop, name + ':' + target, [name, 'design revision B'])
        data = dict(format='synthetic-truenumbers', format_version=1, name=sample.replace('-', ' ').title(),
                    corpus=dict(name=corpus['name'], version=corpus['format_version']), seed=corpus['seed'],
                    notes=corpus['notes'], subjects=subjects, facts=facts)
        (DESTINATION / (sample + '.json')).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
        (DESTINATION / (sample + '.tn')).write_text('\n'.join(f['statement'] for f in facts) + '\n', encoding='utf-8')
        refs = sum(f['value']['type'] == 'reference' for f in facts)
        summary.append((sample, len(subjects), len(facts), refs))
    lines = ['# Navy samples', '', 'Simple patrol-vessel propulsion examples, with one measurement per subject. Only six properties are used across the set: length, rated power, diameter, main engine, drive shaft, and propeller.', '',
             '| Sample | Subjects | Facts | References |', '|---|---:|---:|---:|']
    lines += [f'| {name}.json | {subjects} | {facts} | {refs} |' for name, subjects, facts, refs in summary]
    lines += ['', 'Each JSON has a matching .tn statement list. The smallest sample contains one vessel, its main engine and drive shaft, with one measurement per subject. Small adds the propeller. Fleet repeats that same simple chain for three vessels. No status, material, cooling, fuel, electrical, or dockyard facts.', '',
              'Regenerate from lib/tn_generator with: python regenerate_navy_samples.py', '', 'Corpus: tn_generator/tn_vocabulary_navy.json.', '']
    (DESTINATION / 'README.md').write_text('\n'.join(lines), encoding='utf-8')
    for row in summary:
        print(row)

if __name__ == '__main__':
    main()
