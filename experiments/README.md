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
  intended.
- `011-official-grammar-rebaseline`: official grammar baseline; TypeScript core
  103.888 s, 6.546 GB peak RSS, 107 diagnostics, and 15 fallback files.
- `012-dfa-cache-bounds`: periodic and heap-triggered whole-DFA clearing cuts
  peak RSS 29–41% but costs 22–38% core latency; controls retained as opt-in.
- `013-java-requalification`: reusable cross-runtime structural gate; Java is
  2.30× faster but differs on 51 files and remains evidence-only.
- `014-typescript-reprofile`: optimized tail profile; `general_element_part` and
  `general_element` retain 69.3% of measured prediction time.
- `015-remaining-ll-fallbacks`: 15 files classified; six require LL acceptance
  and nine require LL recovery, so no global removal is correct.
- `016-streaming-parse-seam`: transaction-safe parse-listener API avoids retained
  trees without changing the existing retained-tree API.
- `017-java-token-divergence`: all 51 differences begin at `DOLLAR_IF`; matching
  the conditional-compilation boundary makes all 1,244 token streams and parse
  trees identical. Java remains evidence-only.
- `018-selective-dfa-eviction`: per-decision bounds complete under Node's default
  heap; 26.4% lower peak RSS and 59.9% fewer final DFA states at a 12.0% core
  cost, with zero structural differences. Opt-in; production default unchanged.
- `019-general-element-part-prediction`: decision 2993 is resolved from three
  tokens for ordinary calls, with `(+)`, `TREAT`, and post-error recovery kept
  on the original path. Core fell 33.6% against a same-session control and the
  full corpus remained structurally identical.
- `020-benchmark-policy-identity`: production reports record the effective
  harness heap limit and DFA cache policy; a persistent-cache production-scale
  campaign below 8,192 MiB fails before measurement, and comparison rejects
  differing heap or cache identities unless explicitly overridden.
- `021-unary-expression-core`: decision 2595 resolves from the first two tokens
  except for dedicated function keywords, `USING` modeling clauses, cursor
  attributes, and `CASE`. Core fell a further 7.7% with identical structures,
  diagnostics, and fallback counts.

## Remaining queue

1. Test local transforms for decisions 2990 and 2989 in `general_element` and
   decision 2595 in `unary_expression_core`.
2. Require a standalone Java conditional-compilation boundary before adoption.
3. Localize the remaining valid LL fallbacks.
