# Navy samples

Simple patrol-vessel propulsion examples, with one measurement per subject. Only six properties are used across the set: length, rated power, diameter, main engine, drive shaft, and propeller.

| Sample | Subjects | Facts | References |
|---|---:|---:|---:|
| navy-smallest.json | 3 | 5 | 2 |
| navy-small.json | 4 | 7 | 3 |
| navy-fleet.json | 12 | 21 | 9 |

Each JSON has a matching .tn statement list. The smallest sample contains one vessel, its main engine and drive shaft, with one measurement per subject. Small adds the propeller. Fleet repeats that same simple chain for three vessels. No status, material, cooling, fuel, electrical, or dockyard facts.

Regenerate from lib/tn_generator with: python regenerate_navy_samples.py

Corpus: tn_generator/tn_vocabulary_navy.json.
