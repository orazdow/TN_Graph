# Synthetic Truenumber generator

Python 3.10 or later. Standard library only; no packages, network, NLP model, or TN server required. Keep `generate_tns.py` and `tn_vocabulary.json` together.

## Run

```bash
python generate_tns.py 500
python generate_tns.py 1000 --subjects 120 --structure 1 --output clustered
python generate_tns.py 1000 --subjects 120 --structure 2 --sharing 0.95 --output hubs
python generate_tns.py 500 --connectivity 0.05 --property-overlap 0.95 --tag-overlap 0.95 --output flat_but_related
```

The required positional integer is the fact count. Each run writes `<output>.tn` (one TN per line) and `<output>.json` (entities, typed facts, settings, seed, and measurements). The default prefix is `synthetic_tns`. Existing files at the chosen prefix are overwritten. JSON is a custom interchange format for visualization, not the TN service's native record schema.

## Controls

| Control | Type | Default | Meaning |
|---|---|---|---|
| `facts` | integer | required | Exact number of facts |
| `--subjects` | integer | approximately facts / 4 | Exact distinct subjects, bounded between 1 and facts |
| `--connectivity` | float 0..1 | 0.45 | Reference facts / all facts, rounded to an integer count |
| `--sharing` | float 0..1 | 0.60 | Probability that an additional link targets a favored hub instead of a uniform target |
| `--structure` | integer category | 0 | Topology preset below |
| `--property-overlap` | float 0..1 | 0.65 | Higher values reduce the shared property pools, increasing reuse |
| `--tag-overlap` | float 0..1 | 0.60 | Higher values reduce the shared semantic tag pool, increasing reuse |
| `--literal-reuse` | float 0..1 | 0.25 | Probability of copying a previous value of the same property, when one exists |
| seed | internal integer | random 64-bit | Saved in JSON; supply through Python API to reproduce |

Property pools are chosen separately for relationships and literals. At overlap 1 there is one of each, and at overlap 0 the full available vocabulary is eligible. Tag overlap works the same way. These controls express concentration, not exact percentages of equal properties or tags. Finite pools mean overlap 0 does not forbid repetition.

Approximately 75% of facts get one or two semantic tags. Tags can cross graph clusters. Literal reuse is compatible by property; finite string vocabularies can repeat naturally even at reuse 0. Statistics report both deliberate reuse events and actual repeated literals.

## Presets

| ID | Name | Shape |
|---|---|---|
| 0 | mixed | Neighborhoods with different local motifs and occasional cross-links |
| 1 | clusters | Rings within clusters, followed by mostly local links and occasional bridges |
| 2 | hubs | Initial common-target spokes, then links to favored hubs |
| 3 | chains | A directed chain with forward shortcuts; acyclic when a literal slot exists |
| 4 | cycles | A directed ring, followed by repeated ring links and some chords |
| 5 | islands | Disconnected clusters and approximately 15% reference-isolated subjects |

The initial scaffold gets priority over sharing. With few reference facts, some motifs remain incomplete. With many additional facts, the sharing control has more influence. Chain and cycle presets strongly favor their characteristic successor links, so sharing primarily affects their shortcuts. The chain preset keeps links pointing forward and is acyclic when at least one literal fact is available for its terminal subject. With zero literal facts, every subject must have an outgoing reference, so a finite graph necessarily contains a cycle; the generator reports this constraint.

Every subject appears as the subject of at least one fact. Isolates receive literal facts and remain isolated in the entity-reference graph; shared tags and properties may still connect them in a projection. An all-reference dataset cannot reserve isolates under this rule. A one-subject dataset must round to zero reference facts. The generator never emits self-references or dangling references.

## Projection-friendly JSON

- `subjects`: stable IDs, readable phrases, vocabulary categories, and latent cluster labels.
- `facts`: stable IDs; subject ID and phrase; property; typed value; tags; and the emitted TN sentence.
- Reference values carry a target subject ID and its exact phrase. String values are explicitly typed and quoted in TN text.
- Numeric values carry magnitude, unit, and quantity. Only explicitly mapped numeric properties are sampled.
- `generation`: the actual pools used and the number of scaffold facts.
- `statistics`: exact counts, connected-component sizes, cycle detection, incoming-reference concentration, subjects per property/tag, and literal repetition.
- `notes`: limitations resulting from the chosen parameter combination.

Cluster labels and categories are generator metadata, not additional TN assertions. Components and cycles are computed on the subject-reference graph only. Literal nodes and tags are intentionally left to your visualization's projection rules.

Parallel facts between the same subjects are allowed. If an entire TN sentence would be duplicated, it receives a unique `observation N` tag. This keeps the requested count meaningful for stores that deduplicate identical TNs. `duplicate_observation_tags` and `distinct_semantic_tags` distinguish these bookkeeping tags from ordinary overlap.

## Numeric and semantic scope

The bundled unit vocabulary is used for compatible property/unit selection. This version uses the FIRST unit in each quantity group and generates magnitudes for it; it does not randomly replace units or perform conversions. Absolute temperatures are kelvin, efficiency is a fraction, and counts are integers. Numeric ranges are synthetic and broad, not fitted to particular object classes.

Relationships use general predicates such as `connected item`, `dependency`, and `shared resource`. Entity names and numeric properties are assigned after topology creation. The result is intended to stress structural visualization and grouping, not to simulate a physically consistent engineering installation. For example, an arbitrary entity can receive a mass property. Strict domain rules can be layered on later.

TN sentences use the documented `subject has property = value (tags);` form. No live TN parser was available, so exact unit tokens and ingestion compatibility remain unverified. JSON is usable independently of that parser.

## Reproduce a dataset

```python
import json
from generate_tns import Config, generate, write_dataset

original = json.loads(open('synthetic_tns.json', encoding='utf-8').read())
replayed = generate(Config(**original['settings']), seed=original['seed'])
assert replayed == original
write_dataset(replayed, 'replayed')
```

Use the same generator and vocabulary versions for exact reproduction. You can also pass `vocabulary=<dict>` to `generate`, or `--vocabulary path.json` on the command line.

## Included examples

`samples/` contains one 240-fact, 48-subject dataset per preset, each in TN and JSON form. All use internal seed 20261009; the preset changes the result. `projection_stress` has few references but high property/tag overlap, demonstrating relationships that emerge after flattening. `sample_summary.json` compares their main statistics.

## Verify

```bash
python -m unittest -v
```

Checks cover all presets, exact budgets, connectivity endpoints, unique subjects and statements, valid references, seed replay, numeric quantity/unit consistency, overlap endpoints, cycles, isolates, and invalid inputs.
