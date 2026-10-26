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
`report.json` and `report.md` are copied from `results/<name>/` without edits.
`conclusion.md` records the decision and any threat to validity.

## Rules

- One experiment tests one hypothesis.
- A failed or inconclusive result is recorded, not deleted.
- A rerun gets a new directory. Never overwrite a promoted report.
- Do not promote a report from a private corpus with private paths.
- A grammar patch requires a control and a candidate run.

## Initial queue

1. Reproduce the retained TypeScript sample and compare phase attribution.
2. Measure SLL-only versus SLL-first-with-LL-fallback.
3. Measure parser construction and ATN initialization separately from parse time.
4. Compare repeated pass variance across 3, 5, and 10 executions.
5. Measure the cost of error recovery and segment-first parsing on grammar-gap
   inputs.
6. Profile `general_element`, `general_element_part`, and `routine_name`.
7. Add Java conformance and a full-corpus shared pass.
