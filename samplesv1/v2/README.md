# Engineering samples v2

Generated with tn_generator/tn_vocabulary_v2.json. Subject names have no numeric suffixes. Numeric facts use property-specific units and ranges; references use component names.

| Sample | Subjects | Facts | References | Numeric/string facts |
|---|---:|---:|---:|---:|
| engineering-smallest-2.json (default) | 3 | 4 | 2 | 2 |
| smallest.json | 3 | 12 | 4 | 8 |
| small.json | 6 | 24 | 9 | 15 |
| medium.json | 16 | 64 | 29 | 35 |
| mixed.json | 48 | 240 | 108 | 132 |
| clusters.json | 48 | 240 | 108 | 132 |
| hubs.json | 48 | 240 | 108 | 132 |
| chains.json | 48 | 240 | 108 | 132 |
| cycles.json | 48 | 240 | 108 | 132 |
| islands.json | 48 | 240 | 108 | 132 |
| projection_stress.json | 48 | 240 | 12 | 228 |

Each JSON has a corresponding TN sentence file. Import JSON with Add JSON. Toggle Literal nodes to show or hide the numeric/string leaves. Remove previous sources to inspect one sample by itself.

Regenerate from lib/tn_generator with python regenerate_samples.py. sample_summary.json contains metadata and is not a dataset to import.

smallest.json is a partition of small.json retaining all eight numeric measurements for its three subjects: plate outer west bay → bolt rear service bay → shaft inner lower deck, retaining both coupled shaft assertions and the reverse anchor bolt connection.

engineering-smallest-2.json contains four manually supplied statements connecting the plate, bolt, and shaft, with area and diameter measurements.
