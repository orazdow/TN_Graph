"""Regenerate v2 samples in ../samples/v2 using the default engineering corpus."""
from dataclasses import asdict
import json
from pathlib import Path
from generate_tns import Config, PRESETS, generate, write_dataset


def main():
    destination = Path(__file__).resolve().parent.parent / 'samples' / 'v2'
    configurations = {
        'small': Config(facts=24, subjects=6, connectivity=.375, property_overlap=.35),
        'medium': Config(facts=64, subjects=16),
        **{name: Config(facts=240, subjects=48, structure=preset)
           for preset, (name, _) in PRESETS.items()},
        'projection_stress': Config(facts=240, subjects=48, connectivity=.05,
                                  property_overlap=.95, tag_overlap=.95, literal_reuse=.7),
    }
    summary = []
    for name, config in configurations.items():
        data = generate(config, seed=20261015)
        data['name'] = 'Engineering ' + name.replace('_', ' ')
        write_dataset(data, destination / name)
        stats = data['statistics']
        summary.append({'name': name, 'corpus': data['corpus'],
                        **{key: stats[key] for key in (
                            'subject_count', 'fact_count', 'reference_fact_count',
                            'literal_fact_count', 'weak_component_sizes',
                            'reference_isolated_subjects', 'has_directed_cycle')},
                        'settings': asdict(config), 'seed': data['seed']})
        print(f"{name}: {stats['subject_count']} subjects, {stats['fact_count']} facts, "
              f"{stats['reference_fact_count']} references, {stats['literal_fact_count']} values")
    (destination / 'sample_summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
