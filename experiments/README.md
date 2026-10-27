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
- A grammar or parser-recovery change requires a control, a candidate run, and
  a per-change semantic-conformance gate.

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
- `007-full-file-ll-fallback`: LL prediction for dotted collection methods and a
  `BULK COLLECT` alias guard; LL fallback files fell from 129 to 20 and
  full-corpus parser core fell 24.64% with identical parse-tree digests,
  diagnostics, and token counts.
- `008-memory-profile`: retained-memory and allocation attribution on full, Q4,
  and tail selections; generated DFA caches hold 90–96% of retained heap and
  `getEpsilonTarget` dominates Node allocation volume. No optimization claimed.
- `009-semantic-conformance`: per-change and combined conformance gates for
  issues #1–#3; accepted units, parse trees, tokens, diagnostics, and recovery
  behavior matched, with only the documented LL-fallback removal classified as
  intended. Java remains blocked by its 486 diagnostics.
- `010-upstream-grammar-prs`: eight open upstream PL/SQL pull requests pinned by
  head SHA against their common base, plus the ordered cumulative merge. All
  nine gates pass on the 1,244-file production corpus and eleven reduced
  fixtures; the cumulative candidate accepts four more files and removes five
  fallback files. #5132 reduced the tail parser core by 22.5% in one stable
  screening campaign, but Q4 and full-corpus campaigns are within noise; no
  speedup is claimed. Migration from the current pin is measured separately and
  remains a prerequisite.

## Remaining queue

1. Measure process startup and generated recognizer/ATN initialization as
   separate boundaries.
2. Reduce the remaining fallback files: six SLL-only conflicts and fourteen
   LL-side grammar gaps.
3. Resolve the Java target's 486 diagnostics before treating it as a viable
   adapter.
4. Rebase the #13 candidate onto a newer upstream pin and correct the two
   Oracle-invalid `XMLTABLE` forms in the upstream #5128 example.
