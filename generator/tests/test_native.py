"""Native export checks based on the dashboard's bike export conventions."""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from generate import generate, generate_samples, load_corpus, write_dataset
from native import native_value, phrase_path, to_native


class NativeTests(unittest.TestCase):
    def test_phrase_paths_follow_dashboard_and_language_examples(self):
        for phrase, expected in {
            'handlebar assembly of bicycle': 'bicycle/assembly:handlebar',
            'fork of frame assembly': 'assembly:frame/fork',
            'stem to head tube threaded connection': 'connection:threaded:tube:head:to:stem',
            'M5 bolt B of frame assembly': 'assembly:frame/B:bolt:M5',
            'connected component': 'component:connected',
            'water bottle cradle of frame assembly': 'assembly:frame/cradle:bottle:water',
            'employee ID of John Smith': 'Smith:John/ID:employee',
            'planet:Mars': 'planet:Mars',
            'F-35C aircraft, SN:501662': 'aircraft:F-35C:SN:501662',
            'bicycle/assembly:frame': 'bicycle/assembly:frame',
        }.items():
            with self.subTest(phrase=phrase):
                self.assertEqual(phrase_path(phrase), expected)

    def test_numeric_dashboard_inch_conventions_and_exact_si(self):
        for magnitude, si in [(9, '.2286'), (.8, '.02032'), (17, '.4318')]:
            result = native_value(dict(type='numeric', magnitude=magnitude, unit='inches', quantity='length'))
            self.assertEqual(result['type'], 'numeric')
            self.assertIsInstance(result['magnitude'], str)
            self.assertEqual(result['unitPowers'], [{'p': 1, 'u': 'inches'}])
            self.assertEqual(result['siValue']['unitPowers'], [{'p': 1, 'u': 'm'}])
            self.assertEqual(Decimal(result['siValue']['magnitude']), Decimal(si))
            self.assertEqual(result['tolerance'], '0')
            self.assertEqual(result['siValue']['tolerance'], '0')

    def test_powers_compounds_and_tolerances(self):
        cases = [('mm^2', 20, '.00002'), ('m^3', 2, '2'), ('kW', 2.5, '2500'),
                 ('kN*m', 3, '3000'), ('ft/sec^2', 2, '.6096'), ('%', 50, '.5')]
        for unit, magnitude, si in cases:
            result = native_value(dict(type='numeric', magnitude=magnitude, unit=unit, quantity='test'))
            self.assertEqual(Decimal(result['siValue']['magnitude']), Decimal(si))
        result = native_value(dict(type='numeric', magnitude=34.5, unit='ft', tolerance=.5))
        self.assertEqual(result['siValue']['tolerance'], '0.1524')
        dimensionless = native_value(dict(type='numeric', magnitude=4, unit=''))
        self.assertEqual(dimensionless['unitPowers'], [{'p': 1, 'u': 'unity'}])
        celsius = native_value(dict(type='numeric', magnitude=20, unit='degC'))
        self.assertEqual(celsius['siValue']['magnitude'], '293.15')

    def test_reference_values_and_record_structure(self):
        data = generate(load_corpus('navy'))
        before = deepcopy(data)
        records = to_native(data, numberspace='test/export')
        self.assertEqual(data, before)
        self.assertEqual(records, to_native(data, numberspace='test/export'))
        self.assertEqual(len(records), len(data['facts']))
        for fact, record in zip(data['facts'], records):
            UUID(record['_id'])
            self.assertEqual(record['subject'], phrase_path(fact['subject']))
            self.assertEqual(record['property'], phrase_path(fact['property']))
            self.assertEqual(record['trueStatement'], fact['statement'])
            self.assertEqual(record['numberspace'], 'test/export')
            self.assertNotIn('agent', record)
            self.assertEqual(set(record['tagMeta']), set(record['tags']))
            if fact['value']['type'] == 'reference':
                self.assertEqual(record['value'], {'type': 'srd', 'value': phrase_path(fact['value']['subject']),
                                                   'html': phrase_path(fact['value']['subject'])})

    def test_native_json_and_tn_describe_same_facts(self):
        data = generate(load_corpus('navy'))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'native'
            write_dataset(data, output)
            self.assertEqual(json.loads(output.with_suffix('.json').read_text()), to_native(data))
            self.assertEqual(output.with_suffix('.tn').read_text(),
                             '\n'.join(f['statement'] for f in data['facts']) + '\n')

    def test_complete_sample_set_exports_as_native(self):
        with tempfile.TemporaryDirectory() as directory:
            generate_samples(directory)
            files = list(Path(directory).rglob('*.json'))
            self.assertEqual(len(files), 9)
            for file in files:
                records = json.loads(file.read_text())
                self.assertIsInstance(records, list)
                self.assertEqual(len(records), len(file.with_suffix('.tn').read_text().splitlines()))
                self.assertTrue(all(r['value']['type'] in ('srd', 'numeric') for r in records))

    def test_string_values_are_not_parsed_as_phrases_or_numbers(self):
        for text in ['steel', '41.3 mm', 'assembly:frame/fork', 'A <blue> bicycle & rider', 'line one\nline two']:
            result = native_value(dict(type='string', text=text))
            self.assertEqual(result['type'], 'string')
            self.assertEqual(result['value'], text)
            self.assertNotIn('unitPowers', result)
        result = native_value(dict(type='string', text='<blue> & "quoted"'))
        self.assertEqual(result['html'], '&lt;blue&gt; &amp; &quot;quoted&quot;')
        data = generate(load_corpus('construction'), properties=2)
        records = to_native(data)
        self.assertTrue(any(record['value']['type'] == 'string' for record in records))

    def test_unknown_units_fail_before_writing(self):
        with self.assertRaisesRegex(ValueError, 'unsupported native unit'):
            native_value(dict(type='numeric', magnitude=4, unit='furlong'))
        data = generate(load_corpus('navy'))
        data['facts'][0]['value']['unit'] = 'unknown'
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'bad'
            with self.assertRaises(ValueError):
                write_dataset(data, output)
            self.assertFalse(output.with_suffix('.json').exists())
            self.assertFalse(output.with_suffix('.tn').exists())

    def test_native_cli_output(self):
        with tempfile.TemporaryDirectory() as directory:
            stem = Path(directory)/'native'
            result = subprocess.run([sys.executable, str(ROOT/'generate.py'), '--corpus', 'navy',
                                     '--sample', 'navy-smallest', '--name', 'CLI sample test',
                                     '--numberspace', 'test/export',
                                     '--output', str(stem)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            records = json.loads(stem.with_suffix('.json').read_text())
            self.assertEqual(len(records), 5)
            self.assertTrue(all(r['numberspace'] == 'test/export' for r in records))


if __name__ == '__main__':
    unittest.main()
