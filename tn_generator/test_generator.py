"""Run with: python -m unittest -v"""
import unittest
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
        self.assertEqual(len(high['generation']['relationship_pool']), 1)
        self.assertEqual(len(high['generation']['literal_property_pool']), 1)
        self.assertEqual(len(high['generation']['semantic_tag_pool']), 1)
        self.assertGreater(low['statistics']['distinct_tags'], len(high['generation']['semantic_tag_pool']))

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
