# Benchmark Contract

This document defines the measurement surface. A report that does not satisfy
these definitions is not comparable with a report that does.

## Stages

| Stage | Definition                                                                  | Repeats                     |
| ----- | --------------------------------------------------------------------------- | --------------------------- |
| Cold  | One fresh process per file, parser and ATN constructed in the measured call | `--cold-repeats`, default 3 |
| Warm  | One process, declared warmup calls, then repeated calls on the same source  | `--iterations`, default 5   |
| Pass  | One process, each selected file once in manifest order, when supported      | One execution               |

Cold measures first-use cost, including parser construction and ATN
initialization. Warm measures steady-state parser work. Pass approximates a
single indexing pass but is not a full-build benchmark because the selected
sample is usually smaller than the corpus. An adapter without a shared pass must
label its pass values as per-file.

## Metrics

| Metric              | Definition                                                     |
| ------------------- | -------------------------------------------------------------- |
| `coreMs`            | Tokenization plus parsing; excludes construction               |
| `adapterMs`         | Whole measured call, including construction and bookkeeping    |
| `phases.setupMs`    | Lexer, token stream, parser construction, and ATN initializing |
| `phases.lexerMs`    | Tokenization after construction                                |
| `phases.sllParseMs` | SLL parse                                                      |
| `phases.llParseMs`  | LL fallback parse, zero when not used                          |
| `lexerDiagnostics`  | Lexer errors reported through the ANTLR error listener         |
| `parseDiagnostics`  | Parser errors after the selected prediction mode               |
| `tokens`            | Tokens on the default channel                                  |
| `hiddenTokens`      | Hidden-channel tokens, including comments and whitespace       |
| `prediction`        | `sll`, `sll-fallback-ll`, `ll`, or `unknown`                   |
| `peakRssBytes`      | Process RSS observed at the end of the measured call           |

`coreMs` deliberately excludes process startup, module import, lexer
construction, parser construction, and ATN initialization. Those are reported in
`phases.setupMs` and contribute to `adapterMs`. A report that includes those
costs in `coreMs` must say so.

## Statistics

The report records count, mean, p50, p95, p99, and max per adapter and stage.
For a shared pass, the per-file values sum to the pass total. For an adapter
that only supports a per-file pass, the same sum is not a shared-corpus result;
the report labels that difference in the one-pass semantics line.
Percentiles use linear interpolation between order statistics. Cold values are
the median of the configured fresh-process repetitions; warm values are the
median of the configured samples.

## Comparability rules

1. Same corpus manifest, source digests, and selection.
2. Same warmup, iteration, and cold-repetition counts.
3. Same machine class and container limits.
4. Grammar and patch identity recorded.
5. Runtime and generator versions recorded.
6. No result from a superseded report is mixed into a current comparison.

## Invalid claims

- Extrapolating a full build from a 15-file pass.
- Comparing SLL-only and SLL-first-with-LL-fallback without saying so.
- Reporting a speedup from a runtime switch as a grammar improvement.
- Reporting aggregate parser time without lexer and fallback attribution.
- Treating a benchmark pass as semantic correctness.
