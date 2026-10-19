TN SAMPLE GENERATOR

Python 3.10+, standard library only. No npm or Python packages to install.
One generator handles the construction and navy vocabularies.
Output is dashboard-style native JSON plus a .tn text file.

RUN FROM THIS FOLDER

Generate the complete bundled set directly into samples/:
  python generate.py

Write that same set to a different folder:
  python generate.py --output ../my-samples

Generate a new sample:
  python generate.py --corpus navy --groups 2 --seed 42 --output samples/navy/custom

Limit measurements/text to one property per subject:
  python generate.py --corpus construction --properties 1 --output samples/construction/custom

Choose types and reduce connections:
  python generate.py --corpus navy --types vessel engine shaft --references 0.5

Replay one named example:
  python generate.py --corpus navy --sample navy-smallest --output samples/navy/tiny
  python generate.py --corpus construction --sample engineering-smallest-2

Run tests separately (they use temporary folders):
  python -m unittest discover -s tests -v

CONTROLS

--corpus       Bundled name (navy/construction) or path to a corpus JSON file.
--seed         Repeatable random seed. Default: 20261015.
--groups       Number of named groups, using the corpus names in their order.
--types        Space-separated type names to include. Default: all types.
--properties   Maximum numeric/text properties per subject, randomly selected.
               Omit to use the corpus default; zero omits all literal facts.
--references   Probability of including each allowed reference, from 0 to 1.
--sharing      Prefer an already-used compatible target, from 0 to 1.
               Meaningful when a rule allows several targets (scope: any).
--reuse        Reuse a prior value for the same type/property, from 0 to 1.
--name         Display name of the dataset.
--output       Destination folder for the complete set, or filename stem for a
               single sample. Defaults to samples/ beside generate.py.
--numberspace  Native JSON numberspace identifier. Default: generated.

Reference probability is not an exact edge quota. Property limits exclude
reference properties. Groups create one subject per included type; add names
to the corpus to support larger samples. The generator adds no numeric suffixes
to subject phrases. It does not solve physical engineering constraints.

CORPUS FORMAT

Start with corpus/navy.json. Its vocabulary/rules are separate from samples.
The required top-level fields are version (1), name, names, and types.
Optional fields include tags, tag_group, notes, defaults, and samples.

Minimal example:

  {
    "version": 1,
    "name": "Workshop",
    "names": ["west bay", "east bay"],
    "tags": ["design revision B"],
    "types": {
      "plate": {
        "phrase": "plate {name}",
        "properties": {
          "area": {"unit": "m^2", "quantity": "area", "range": [10, 40]},
          "material": {"choices": ["steel", "aluminium"]}
        },
        "references": [{"property": "fastener", "target": "bolt"}]
      },
      "bolt": {
        "phrase": "bolt {name}",
        "properties": {
          "diameter": {"unit": "mm", "range": [10, 30], "decimals": 1}
        }
      }
    }
  }

Numeric properties have unit, range, optional quantity, and optional decimals
(default 1). String properties have choices. Facts normally get their group
name plus the corpus tags; set tag_group to false to omit the group tag.

References define allowed source-property-target combinations, not fixed edges.
Each rule belongs to its source type. The default scope, group, chooses the
target inside the same named group. Use scope: any to allow targets across all
groups. Self-links are excluded unless allow_self is true. Rules whose target
type was excluded by --types are skipped. Duplicate phrase templates are errors.

The code creates IDs, resolves references, samples values, formats statements,
and writes files. Adding another domain normally means writing another corpus.

BUNDLED EXAMPLES

corpus/navy.json has three named samples defined by ordinary generation options.
corpus/construction.json points to three fixed datasets in recipes/ because these examples
were generated previously and then manually partitioned or edited. Those recipes
preserve their original statement text and tags.
New construction data uses the cleaner type rules, not these fixed recipes.
Keeping fixed examples separate makes the vocabulary files easier to edit.

Named generated samples can take overrides. Fixed samples reject overrides;
omit --sample to generate a new variation. The complete set has nine JSON/TN
pairs, including three top-level aliases. Recipes use a private generation
model, not a public input format.

Tests compare against saved SHA-256 hashes; no original project files are needed.
The workbench accepts native TN JSON and .tn files through Add data.

NATIVE JSON TRANSLATION

native.py converts internal facts to an array of dashboard-style TN records.
It encodes subject/property/tag phrases as paths, reference values as srd,
and numeric magnitudes/tolerances as strings with unitPowers and siValue.
SI conversions use Decimal arithmetic. Export IDs are stable UUIDs; no creator
email, user ID, or creation time is invented. Supply --numberspace to use a
particular numberspace identifier rather than the synthetic default.

Numeric and phrase structures follow the supplied bike export. String values
use type: string and retain their text in value without phrase-path parsing.
The html field is escaped for display. Unknown units produce an error.
Extend the SI unit table in native.py to
support additional units. This does not establish live TN server acceptance.

Native TN JSON and TN text are the only output formats; both are always written.
The viewer normalizes either into its private graph model. Native metadata is
retained, while structured values determine references, numbers, and strings.
