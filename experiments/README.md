# Experiments

Each promoted experiment has one directory:

```text
experiments/001-prediction-baseline/
  config.json
  report.json
  report.md
  conclusion.md
```

`config.json` records the exact invocation and acceptance criteria.
`report.json` and `report.md` are generated from `results/<name>/`. Private raw
per-file repetitions stay ignored; only the audited opaque publication report is
promoted.
`conclusion.md` records the decision and any threat to validity.

## Rules

- One experiment tests one hypothesis.
- A failed or inconclusive result is recorded, not deleted.
- A rerun gets a new directory. Never overwrite a promoted report.
- Do not promote a report from a private corpus with private paths.
- A grammar patch requires a control and a candidate run.

## Completed

- `001-public-baseline`: superseded one-repeat harness baseline; measurement
  boundary corrected.
- `002-stable-public-baseline`: three-repeat public baseline with both adapters.
- `003-production-scale`: complete opaque production corpus, phase attribution,
  memory, confidence, and size strata.
- `004-bottleneck-profile`: Java decision profiling for `general_element_part`,
  `routine_name`, and `general_element` on the production tail.
- `005-general-element-part-optimization`: guarded generated prediction for
  `general_element_part`; 10.48% full-corpus TypeScript parser-core reduction.
- `006-routine-name-and-general-element`: two-token lookahead for `routine_name`
  and PERIOD gates for both `general_element` loops; 10.97% further full-corpus
  and 19.73% tail reduction with identical parse-tree digests.

## Remaining queue

1. Measure process startup and generated recognizer/ATN initialization as
   separate boundaries.
2. Measure the cost of error recovery and segment-first parsing on grammar-gap
   inputs.
3. Run semantic conformance before treating the faster Java target as a viable
   adapter.
