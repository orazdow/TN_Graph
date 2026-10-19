#!/usr/bin/env python3
"""Small, corpus-driven TN sample generator. Python 3.10+, no dependencies.

New samples use type vocabularies and allowed reference rules. Named recipes
either supply generation options or retain a fixed, hand-edited dataset.
Nothing in this module knows about construction or naval equipment.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parent
FIELDS = ("seed", "groups", "types", "properties", "references", "sharing", "reuse", "name")


def load_corpus(filename):
    """Resolve bundled corpus names, or load a user's JSON file."""
    path = Path(filename)
    if not path.is_file():
        path = ROOT / "corpus" / (str(filename) + ".json")
    corpus = json.loads(path.read_text(encoding="utf-8"))
    # Resolve optional fixed recipes relative to their corpus, wherever it lives.
    corpus["_directory"] = str(path.resolve().parent)
    if corpus.get("version") != 1 or not corpus.get("types") or not corpus.get("names"):
        raise ValueError("corpus needs version: 1, nonempty types, and names")
    for kind, spec in corpus["types"].items():
        for rule in spec.get("references", []):
            if rule["target"] not in corpus["types"]:
                raise ValueError(f"{kind}: unknown reference target {rule['target']}")
            if rule.get("scope", "group") not in ("group", "any"):
                raise ValueError("reference scope must be group or any")
        for prop, value in spec.get("properties", {}).items():
            if "choices" in value:
                if not value["choices"] or not all(isinstance(x, str) for x in value["choices"]):
                    raise ValueError(f"{kind}.{prop}: choices must be nonempty strings")
            else:
                bounds = value.get("range", [])
                if (len(bounds) != 2 or any(isinstance(x, bool) or not isinstance(x, (int, float))
                                           or not math.isfinite(x) for x in bounds)
                        or bounds[0] > bounds[1] or not isinstance(value.get("unit"), str)):
                    raise ValueError(f"{kind}.{prop}: supply a finite ascending range and unit")
                precision = value.get("decimals", 1)
                if type(precision) is not int or not 0 <= precision <= 8:
                    raise ValueError(f"{kind}.{prop}: decimals must be between 0 and 8")
    return corpus


def statement(subject, prop, value, tags):
    """References use subject phrases; strings stay visibly quoted."""
    if value["type"] == "reference":
        text = value["subject"]
    elif value["type"] == "string":
        text = json.dumps(value["text"])
    else:
        text = str(value["magnitude"]) + (" " + value["unit"] if value["unit"] else "")
    context = " (" + ", ".join(tags) + ")" if tags else ""
    return f"{subject} has {prop} = {text}{context};"


def validate_dataset(data):
    """Catch invalid output before writing either file; never infer references."""
    if data.get("format") != "synthetic-truenumbers" or data.get("format_version") != 1:
        raise ValueError("unsupported dataset format")
    subjects = {s["id"]: s["phrase"] for s in data["subjects"]}
    if len(subjects) != len(data["subjects"]):
        raise ValueError("duplicate subject IDs")
    seen = set()
    for fact in data["facts"]:
        if fact["id"] in seen:
            raise ValueError("duplicate fact IDs")
        seen.add(fact["id"])
        if subjects.get(fact["subject_id"]) != fact["subject"]:
            raise ValueError("unknown or mismatched fact subject")
        if not isinstance(fact["property"], str) or not fact["property"].strip():
            raise ValueError("empty property")
        if not isinstance(fact["tags"], list) or not all(isinstance(t, str) and t.strip() for t in fact["tags"]):
            raise ValueError("invalid tags")
        value = fact["value"]
        if value["type"] == "reference":
            if subjects.get(value["subject_id"]) != value["subject"]:
                raise ValueError("dangling or mismatched reference")
        elif value["type"] == "numeric":
            if (type(value["magnitude"]) not in (int, float)
                    or not math.isfinite(value["magnitude"]) or not isinstance(value["unit"], str)):
                raise ValueError("invalid numeric value")
        elif value["type"] != "string" or not isinstance(value["text"], str):
            raise ValueError("unsupported value")
    return data


def generate(corpus, **overrides):
    """Create named groups of typed subjects, then their facts.

    A group can be a vessel, building, location, or other naming context. Each
    selected type has one subject per group. Rules allow links within a group
    or across all groups; probability and sharing select the actual links.
    """
    options = dict(seed=20261015, groups=1, types=list(corpus["types"]),
                   properties=None, references=1.0, sharing=0.0, reuse=0.0,
                   name=corpus["name"] + " sample")
    options.update(corpus.get("defaults", {}))
    options.update({key: value for key, value in overrides.items() if value is not None})
    kinds, count = options["types"], options["groups"]
    if not kinds or len(set(kinds)) != len(kinds) or any(k not in corpus["types"] for k in kinds):
        raise ValueError("types must be distinct names defined by the corpus")
    if type(count) is not int or not 1 <= count <= len(corpus["names"]):
        raise ValueError(f"groups must be between 1 and {len(corpus['names'])}; add names for larger samples")
    if options["properties"] is not None and (type(options["properties"]) is not int or options["properties"] < 0):
        raise ValueError("properties must be a nonnegative integer")
    for key in ("references", "sharing", "reuse"):
        if not isinstance(options[key], (int, float)) or not 0 <= options[key] <= 1:
            raise ValueError(f"{key} must be between 0 and 1")
    rng = random.Random(options["seed"])
    groups = corpus["names"][:count]
    subjects, facts, lookup, phrases = [], [], {}, set()
    # Keep generated IDs separate from readable subject names.
    for group in groups:
        for kind in kinds:
            spec = corpus["types"][kind]
            phrase = spec["phrase"].format(name=group, type=kind)
            identifier = f"{group}:{kind}"
            if phrase in phrases or identifier in lookup:
                raise ValueError("names and phrase templates must produce unique subjects")
            phrases.add(phrase)
            subject = dict(id=identifier, phrase=phrase, category=kind)
            subjects.append(subject)
            lookup[identifier] = subject

    def add(subject, prop, value, tags):
        facts.append(dict(id=f"fact-{len(facts) + 1}", subject_id=subject["id"],
                          subject=subject["phrase"], property=prop, value=value, tags=tags,
                          statement=statement(subject["phrase"], prop, value, tags)))

    values, favorites = {}, {}
    for group in groups:
        tags = ([group] if corpus.get("tag_group", True) else []) + corpus.get("tags", [])
        for kind in kinds:
            spec = corpus["types"][kind]
            properties = list(spec.get("properties", {}).items())
            limit = options["properties"]
            if limit is not None and limit < len(properties):
                properties = rng.sample(properties, limit)
            for prop, definition in properties:
                # Reuse only within the same type/property/specification.
                key = (kind, prop)
                previous = values.get(key, [])
                if previous and options["reuse"] > 0 and rng.random() < options["reuse"]:
                    value = deepcopy(rng.choice(previous))
                elif "choices" in definition:
                    value = dict(type="string", text=rng.choice(definition["choices"]))
                else:
                    decimals = definition.get("decimals", 1)
                    number = round(rng.uniform(*definition["range"]), decimals)
                    if decimals == 0:
                        number = int(number)
                    value = dict(type="numeric", magnitude=number, unit=definition["unit"])
                    if "quantity" in definition:
                        value["quantity"] = definition["quantity"]
                values.setdefault(key, []).append(value)
                add(lookup[f"{group}:{kind}"], prop, value, tags.copy())
        # Relations are a separate pass: limiting properties never removes links.
        for kind in kinds:
            source = lookup[f"{group}:{kind}"]
            for rule in corpus["types"][kind].get("references", []):
                probability = options["references"]
                if rule["target"] not in kinds or probability == 0:
                    continue
                if probability < 1 and rng.random() >= probability:
                    continue
                candidates = [s for s in subjects if s["category"] == rule["target"]
                              and (rule.get("scope", "group") == "any"
                                   or s["id"] == f"{group}:{rule['target']}")
                              and (rule.get("allow_self", False) or s["id"] != source["id"])]
                if not candidates:
                    continue
                key = (kind, rule["property"], rule["target"])
                preferred = favorites.get(key)
                if len(candidates) == 1:
                    target = candidates[0]
                elif preferred in candidates and options["sharing"] > 0 and rng.random() < options["sharing"]:
                    target = preferred
                else:
                    target = rng.choice(candidates)
                favorites.setdefault(key, target)
                add(source, rule["property"], dict(type="reference", subject_id=target["id"],
                                                   subject=target["phrase"]), tags.copy())
    return validate_dataset(dict(format="synthetic-truenumbers", format_version=1, name=options["name"],
                                 corpus=dict(name=corpus["name"], version=corpus["version"]),
                                 seed=options["seed"], notes=corpus.get("notes", []), subjects=subjects, facts=facts))


def sample(corpus, name, **overrides):
    """Fixed recipes preserve historical examples, including their oddities."""
    recipe = corpus.get("samples", {}).get(name)
    if recipe is None:
        raise ValueError(f"unknown sample {name}; choices: {', '.join(corpus.get('samples', {}))}")
    if "file" in recipe:
        if any(value is not None for value in overrides.values()):
            raise ValueError("fixed samples cannot take generation overrides; omit --sample to generate variations")
        path = Path(corpus["_directory"]) / recipe["file"]
        return validate_dataset(json.loads(path.read_text(encoding="utf-8")))
    return generate(corpus, **(recipe.get("options", {}) | {k: v for k, v in overrides.items() if v is not None}))


def write_dataset(data, output, newlines=None):
    """Write JSON and readable statements; preserve recorded line endings on replay."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    for extension, text in (("json", json.dumps(data, indent=2) + "\n"),
                            ("tn", "\n".join(f["statement"] for f in data["facts"]) + "\n")):
        newline = (newlines or {}).get(extension, "\n")
        output.with_suffix("." + extension).write_bytes(text.replace("\n", newline).encode("utf-8"))


def generate_samples(output):
    """Write the bundled sample set directly to the requested folder."""
    output = Path(output)
    for filename in sorted((ROOT / "corpus").glob("*.json")):
        corpus = load_corpus(filename)
        for name, recipe in corpus.get("samples", {}).items():
            data = sample(corpus, name)
            for destination in recipe.get("outputs", []):
                write_dataset(data, output / destination, recipe.get("newlines"))
    # Small text sidecars are part of the original review handoff, not datasets.
    files = json.loads((ROOT / "sample_files.json").read_text(encoding="utf-8"))
    for filename, text in files.items():
        target = output / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", help="generate one variation using this bundled name or corpus JSON path")
    parser.add_argument("--sample", help="named reproducible recipe; omit for new data")
    parser.add_argument("--output", type=Path, help="sample-set folder, or filename stem when generating one sample")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--groups", type=int, help="number of named assemblies/locations")
    parser.add_argument("--types", nargs="+", help="subject types to include")
    parser.add_argument("--properties", type=int, help="maximum numeric/text properties per subject")
    parser.add_argument("--references", type=float, help="probability of each allowed reference, 0..1")
    parser.add_argument("--sharing", type=float, help="prefer an already-used allowed reference target, 0..1")
    parser.add_argument("--reuse", type=float, help="reuse a previous compatible literal value, 0..1")
    parser.add_argument("--name", help="dataset display name")
    args = parser.parse_args()
    try:
        options = {field: getattr(args, field) for field in FIELDS}
        if not args.corpus and not args.sample and not any(v is not None for v in options.values()):
            output = args.output if args.output is not None else ROOT / "samples"
            generate_samples(output)
            print(f"Samples written to {output}")
        else:
            corpus_name = args.corpus or "navy"
            corpus = load_corpus(corpus_name)
            data = sample(corpus, args.sample, **options) if args.sample else generate(corpus, **options)
            recipe = corpus.get("samples", {}).get(args.sample, {})
            output = args.output if args.output is not None else ROOT / "samples" / (args.sample or "sample")
            write_dataset(data, output, recipe.get("newlines"))
            print(f"{len(data['subjects'])} subjects, {len(data['facts'])} facts -> {output}.json/.tn")
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
