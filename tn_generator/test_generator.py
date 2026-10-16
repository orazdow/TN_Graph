"""Run with: python -m unittest -v"""
import unittest
from pathlib import Path
import re
from generate_tns import Config, generate, load_vocabulary

class GeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vocabulary = load_vocabulary()

    def check_dataset(self, config, seed=123):
        data = generate(config, seed=seed, vocabulary=self.vocabulary)
        self.assertEqual(len(data['facts']), config.facts)
        n = data['settings']['subjects']
        self.assertEqual(len(data['subjects']), n)
        subjects = {s['id']: s['phrase'] for s in data['subjects']}
        self.assertEqual(len(set(subjects.values())), n)
        self.assertEqual({f['subject_id'] for f in data['facts']}, set(subjects))
        self.assertEqual(len({f['statement'] for f in data['facts']}), config.facts)
        refs = [f for f in data['facts'] if f['value']['type'] == 'reference']
        self.assertEqual(len(refs), round(config.facts * config.connectivity))
        for f in data['facts']:
            self.assertEqual(f['subject'], subjects[f['subject_id']])
            if f['value']['type'] == 'reference':
                target = f['value']['subject_id']
                self.assertNotEqual(f['subject_id'], target)
                self.assertEqual(f['value']['subject'], subjects[target])
            elif f['value']['type'] == 'numeric':
                q = self.vocabulary['property_quantity_map'][f['property']]
                self.assertEqual(f['value']['quantity'], q)
                self.assertIn(f['value']['unit'], self.vocabulary['units_by_quantity'][q])
        return data

    def test_counts_references_and_uniqueness_across_presets(self):
        for preset in range(6):
            for n, total in [(2, 2), (3, 15), (8, 8), (25, 200)]:
                for connectivity in [0, .1, .45, .95, 1]:
                    with self.subTest(preset=preset, n=n, total=total, connectivity=connectivity):
                        self.check_dataset(Config(facts=total, subjects=n, structure=preset, connectivity=connectivity))

    def test_single_subject_and_rounding(self):
        self.check_dataset(Config(facts=1, connectivity=0))
        self.check_dataset(Config(facts=30, subjects=1, connectivity=0))
        self.check_dataset(Config(facts=1))  # round(.45) -> zero references

    def test_seed_replay(self):
        config = Config(facts=250, structure=0)
        a = generate(config, seed=123, vocabulary=self.vocabulary)
        b = generate(Config(**a['settings']), seed=a['seed'], vocabulary=self.vocabulary)
        self.assertEqual(a, b)
        self.assertNotEqual(a, generate(config, seed=124, vocabulary=self.vocabulary))

    def test_cycles_and_isolates(self):
        chain = self.check_dataset(Config(facts=300, subjects=50, structure=3))
        self.assertFalse(chain['statistics']['has_directed_cycle'])
        cyclic = self.check_dataset(Config(facts=300, subjects=50, structure=4))
        self.assertTrue(cyclic['statistics']['has_directed_cycle'])
        islands = self.check_dataset(Config(facts=300, subjects=50, structure=5))
        self.assertGreater(islands['statistics']['reference_isolated_subjects'], 0)
        self.assertGreater(len(islands['statistics']['weak_component_sizes']), 2)
        reserved = {s['id'] for s in islands['subjects'] if s['reserved_isolate']}
        for f in islands['facts']:
            if f['value']['type'] == 'reference':
                self.assertNotIn(f['subject_id'], reserved)
                self.assertNotIn(f['value']['subject_id'], reserved)

    def test_overlap_endpoints(self):
        low = self.check_dataset(Config(facts=1000, property_overlap=0, tag_overlap=0))
        high = self.check_dataset(Config(facts=1000, property_overlap=1, tag_overlap=1))
        self.assertGreater(low['statistics']['distinct_properties'], high['statistics']['distinct_properties'])
        self.assertTrue(all(len(pool) == 1 for pool in high['generation']['relationship_pools_by_category'].values()))
        self.assertEqual(len(high['generation']['literal_property_pool']), 1)
        self.assertEqual(len(high['generation']['semantic_tag_pool']), 1)
        self.assertGreater(low['statistics']['distinct_tags'], len(high['generation']['semantic_tag_pool']))

    def test_engineering_corpus_units_ranges_and_reference_meanings(self):
        data = self.check_dataset(Config(facts=1000, property_overlap=0, tag_overlap=0))
        definitions = self.vocabulary['numeric_properties']
        self.assertEqual(len(definitions), 20)
        self.assertEqual(data['corpus']['version'], 2)
        categories = {subject['id']: subject['category'] for subject in data['subjects']}
        observed = set()
        for fact in data['facts']:
            value = fact['value']
            if value['type'] == 'numeric':
                spec = definitions[fact['property']]
                self.assertEqual(value['quantity'], spec['quantity'])
                self.assertEqual(value['unit'], spec['unit'])
                self.assertGreaterEqual(value['magnitude'], spec['min'])
                self.assertLessEqual(value['magnitude'], spec['max'])
                observed.add(fact['property'])
            elif value['type'] == 'reference':
                allowed = self.vocabulary['reference_properties_by_category'][categories[value['subject_id']]]
                self.assertIn(fact['property'], allowed)
        self.assertEqual(observed, set(definitions))
        for subject in data['subjects']:
            self.assertIsNone(re.search(r'-[0-9]+$', subject['phrase']))
            self.assertFalse(any(character.isdigit() for character in subject['phrase']))

    def test_legacy_corpus_can_still_be_selected(self):
        legacy = load_vocabulary(Path(__file__).with_name('tn_vocabulary.json'))
        data = generate(Config(facts=80, subjects=20), seed=123, vocabulary=legacy)
        self.assertEqual(len(data['facts']), 80)
        self.assertEqual(len({subject['phrase'] for subject in data['subjects']}), 20)

    def test_subject_name_capacity_is_explicit(self):
        tiny = dict(self.vocabulary)
        tiny['subject_terms'] = {'beams': ['beam']}
        tiny['reference_names'] = {'names': ['north bay']}
        with self.assertRaisesRegex(ValueError, 'unique subject phrases'):
            generate(Config(facts=8, subjects=2), seed=123, vocabulary=tiny)

    def test_invalid_inputs(self):
        cases = [Config(facts=0), Config(facts=-2), Config(facts=True),
                 Config(facts=10, subjects=11), Config(facts=10, subjects=0),
                 Config(facts=10, subjects=1, connectivity=1),
                 Config(facts=10, structure=9), Config(facts=10, sharing=float('nan')),
                 Config(facts=10, tag_overlap=2), Config(facts=10, connectivity=-.1)]
        for config in cases:
            with self.subTest(config=config), self.assertRaises(ValueError):
                generate(config, vocabulary=self.vocabulary)

if __name__ == '__main__':
    unittest.main()
