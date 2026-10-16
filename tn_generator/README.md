# Synthetic Truenumber generator

Python 3.10+, standard library only. The default corpus is **tn_vocabulary_v2.json**, a structural-engineering vocabulary. The original tn_vocabulary.json is retained as an optional legacy corpus.

## Run

```powershell
python generate_tns.py 500
python generate_tns.py 1000 --subjects 120 --structure 1 --output clustered
python generate_tns.py 1000 --subjects 120 --structure 2 --sharing 0.95 --output hubs
python generate_tns.py 500 --connectivity 0.05 --property-overlap 0.95 --tag-overlap 0.95 --output shared_features
python generate_tns.py 100 --vocabulary tn_vocabulary.json --output legacy
```

Each run writes an output-prefix.json file and an output-prefix.tn file. Existing files at that prefix are overwritten. JSON remains the viewer's synthetic-truenumbers interchange format, version 1; corpus version 2 does not change the import schema.

## Engineering corpus

The twenty numeric properties are length, width, height, diameter, wall thickness, support width, span, mass, cross section area, volume, shear stress, tensile stress, allowable stress, Youngs modulus, deflection, axial force, bending moment, torque, temperature, and safety factor.

Each numeric_properties entry defines quantity, output unit, minimum, maximum, and decimal precision. For example, shear stress uses MPa, support width uses mm, mass uses kg, and torque uses N*m. Temperatures are absolute kelvin; safety factors are dimensionless. Values are sampled directly in the specified output unit. No conversion is implied.

Material, condition, and status use small sets of readable string values. References use concrete component properties, chosen by the target's category: a mounting bracket refers to a bracket, a shaft bearing to a bearing, and a support beam to a beam. These rules make the associations readable; the generated topology is still synthetic, not a complete engineering assembly model or structural analysis.

Subject phrases combine a physical component with a descriptive location, such as beam outer loading platform. Phrases are sampled without replacement, with no numeric suffixes. Internal IDs remain separate. The default corpus supports 512 distinct subjects; larger collections need more corpus terms or names. Exceeding that capacity produces an explicit error rather than silently adding suffixes.

The legacy corpus uses its older quantity-level unit selection and numeric ranges. The new per-property definitions take precedence when present.

## Controls

| Control | Default | Meaning |
|---|---|---|
| facts | required | Exact positive fact count |
| --subjects | approximately facts / 4 | Exact subject count; every subject gets a fact |
| --connectivity | 0.45 | Fraction of facts referencing subjects, rounded to an exact budget |
| --sharing | 0.60 | Bias toward common reference targets |
| --structure | 0 | Topology preset, listed below |
| --property-overlap | 0.65 | Higher values reduce eligible property pools |
| --tag-overlap | 0.60 | Higher values reduce the semantic tag pool |
| --literal-reuse | 0.25 | Chance of copying a prior value of the same property |
| --vocabulary | tn_vocabulary_v2.json | Alternative corpus path |
| --output | synthetic_tns | Prefix for JSON and TN files |

Probability controls accept values from 0 to 1. Overlap describes pool concentration, not an exact observed percentage. For the engineering corpus, reference pools are chosen separately per target category, so high overlap never substitutes an inappropriate component type. Literal properties use one shared pool.

## Topology presets

0 mixed; 1 clusters; 2 hubs; 3 chains; 4 cycles; 5 islands.

Topology is allocated first, then subjects, properties, and values are assigned. References have no dangling targets or self-links. Parallel facts remain allowed. Identical statements receive observation tags so every requested fact remains distinguishable.

A small reference budget can leave motifs partial. Islands need literal facts to cover isolated subjects. A finite all-reference collection in which every subject has an outgoing connection must contain a cycle, so a chain can only stay acyclic when its terminal subject has a literal fact instead.

## V2 samples

```powershell
python regenerate_samples.py
```

This writes JSON and TN files into **../samples/construction/** using seed 20261015:

- small: 6 subjects, 24 facts; the workbench's default sample.
- medium: 16 subjects, 64 facts.
- mixed, clusters, hubs, chains, cycles, islands: 48 subjects, 240 facts each.
- projection_stress: 48 subjects, 240 facts, only 12 references, with concentrated property/tag reuse.
- sample_summary.json: sizes, topology measurements, settings, and seeds; this is an index, not an importable dataset.

The earlier samples remain in this package's samples folder and in ../samples. Load alternate JSON datasets with Add JSON in the workbench.

## Reproduce and verify

The JSON records its settings, seed, and corpus identity. For identical output, keep the generator and corpus versions unchanged and call generate(Config(**original['settings']), seed=original['seed']). When using a non-default corpus, also pass that corpus through vocabulary=load_vocabulary(path).

```powershell
python -m unittest -v
```

Tests cover exact budgets, valid references, seed replay, topology constraints, numeric ranges and units, target-compatible relationship properties, suffix-free names, corpus capacity, overlap controls, and legacy-corpus selection.
