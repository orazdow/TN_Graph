"""Public, standalone checks: run python -m unittest discover -s tests -v."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from generate import generate_samples, generate, load_corpus, sample, validate_dataset


class GeneratorTests(unittest.TestCase):
    def test_exact_review_recreation(self):
        """Golden hashes were captured from the existing review handoff."""
        expected = json.loads((ROOT / "tests" / "review_hashes.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            generate_samples(directory)
            actual = {p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in Path(directory).rglob("*") if p.is_file()}
            self.assertEqual(actual, expected)
            for file in Path(directory).rglob("*.json"):
                data = validate_dataset(json.loads(file.read_text()))
                text = file.with_suffix(".tn").read_text()
                self.assertEqual(text, "\n".join(f["statement"] for f in data["facts"]) + "\n")

    def test_default_command_generates_samples_directly(self):
        # Exercise a standalone copy so the no-argument command uses its own samples/.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "generator"
            root.mkdir()
            for name in ("generate.py", "sample_files.json"):
                shutil.copy2(ROOT / name, root / name)
            for name in ("corpus", "recipes"):
                shutil.copytree(ROOT / name, root / name)
            command = [sys.executable, str(root / "generate.py")]
            result = subprocess.run(command, cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            expected = json.loads((ROOT / "tests" / "review_hashes.json").read_text())
            actual = {p.relative_to(root / "samples").as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in (root / "samples").rglob("*") if p.is_file()}
            self.assertEqual(actual, expected)
            self.assertFalse((root / "generated").exists())
            other = Path(directory) / "custom-samples"
            result = subprocess.run(command + ["--output", str(other)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((other / "navy" / "navy-small.json").is_file())

    def test_seed_and_no_mutation(self):
        corpus = load_corpus("navy")
        before = deepcopy(corpus)
        first = generate(corpus, seed=42, groups=2)
        self.assertEqual(first, generate(corpus, seed=42, groups=2))
        self.assertNotEqual(first["facts"], generate(corpus, seed=43, groups=2)["facts"])
        self.assertEqual(corpus, before)

    def test_type_property_and_reference_controls(self):
        corpus = load_corpus("navy")
        data = generate(corpus, groups=2, types=["vessel", "engine"], references=0)
        self.assertEqual(len(data["subjects"]), 4)
        self.assertEqual(len(data["facts"]), 4)
        self.assertTrue(all(f["value"]["type"] == "numeric" for f in data["facts"]))
        only_links = generate(corpus, groups=2, properties=0)
        self.assertEqual(len(only_links["facts"]), 6)
        self.assertTrue(all(f["value"]["type"] == "reference" for f in only_links["facts"]))
        # Allowed targets remain in the source group; target exclusion is safe.
        for fact in only_links["facts"]:
            self.assertEqual(fact["subject_id"].split(":")[0], fact["value"]["subject_id"].split(":")[0])

    def test_ranges_units_strings_and_property_limit(self):
        corpus = load_corpus("construction")
        data = generate(corpus, groups=4, properties=2)
        categories = {s["id"]: s["category"] for s in data["subjects"]}
        for fact in data["facts"]:
            if fact["value"]["type"] == "reference":
                continue
            spec = corpus["types"][categories[fact["subject_id"]]]["properties"][fact["property"]]
            value = fact["value"]
            if "choices" in spec:
                self.assertIn(value["text"], spec["choices"])
            else:
                self.assertEqual(value["unit"], spec["unit"])
                self.assertTrue(spec["range"][0] <= value["magnitude"] <= spec["range"][1])
        limited = generate(corpus, groups=2, properties=1, references=0)
        self.assertEqual(len(limited["facts"]), len(limited["subjects"]))

    def test_cross_group_sharing_and_value_reuse(self):
        corpus = load_corpus("navy")
        corpus["types"]["vessel"]["references"][0]["scope"] = "any"
        data = generate(corpus, groups=3, sharing=1, reuse=1)
        targets = {f["value"]["subject_id"] for f in data["facts"] if f["property"] == "main engine"}
        self.assertEqual(len(targets), 1)
        for prop in ("length", "rated power"):
            values = [f["value"] for f in data["facts"] if f["property"] == prop]
            self.assertEqual(values, [values[0]] * 3)

    def test_generated_recipe_overrides_and_fixed_recipe_guards(self):
        data = sample(load_corpus("navy"), "navy-small", groups=2, references=0)
        self.assertEqual(len(data["subjects"]), 8)
        with self.assertRaisesRegex(ValueError, "fixed samples"):
            sample(load_corpus("construction"), "smallest", seed=1)

    def test_invalid_options_and_ambiguous_names(self):
        corpus = load_corpus("navy")
        for options in ({"groups": 0}, {"groups": 4}, {"types": ["unknown"]},
                        {"types": ["vessel", "vessel"]}, {"properties": -1},
                        {"references": 1.1}, {"sharing": -1}, {"reuse": float("nan")}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                generate(corpus, **options)
        corpus["types"]["engine"]["phrase"] = corpus["types"]["vessel"]["phrase"]
        with self.assertRaisesRegex(ValueError, "unique subjects"):
            generate(corpus)

    def test_custom_corpus_and_self_link_policy(self):
        corpus = dict(version=1, name="People", names=["Ada", "Grace"], types={
            "person": dict(phrase="person {name}", properties={"role": {"choices": ["reviewer"]}},
                           references=[dict(property="colleague", target="person", scope="any")])})
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "people.json"
            file.write_text(json.dumps(corpus))
            loaded = load_corpus(file)
            data = generate(loaded, groups=2)
            links = [f for f in data["facts"] if f["value"]["type"] == "reference"]
            self.assertEqual(len(links), 2)
            self.assertTrue(all(f["subject_id"] != f["value"]["subject_id"] for f in links))
            self.assertEqual(len(generate(loaded, groups=1)["facts"]), 1)
            loaded["types"]["person"]["references"][0]["allow_self"] = True
            self.assertEqual(len(generate(loaded, groups=1)["facts"]), 2)

    def test_cli_and_output(self):
        with tempfile.TemporaryDirectory() as directory:
            stem = Path(directory) / "demo"
            command = [sys.executable, str(ROOT / "generate.py"), "--corpus", "navy",
                       "--groups", "2", "--properties", "0", "--output", str(stem)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(stem.with_suffix(".json").read_text())
            self.assertEqual(len(data["subjects"]), 8)
            self.assertEqual(len(data["facts"]), 6)
            bad = subprocess.run(command + ["--references", "2"], capture_output=True, text=True)
            self.assertEqual(bad.returncode, 2)
            self.assertIn("references must", bad.stderr)


if __name__ == "__main__":
    unittest.main()
