# Benchmark Contract

This document defines the measurement surface. A report that does not satisfy
these definitions is not comparable with a report that does.

## Stages

| Stage | Definition                                                                                      | Repeats                     |
| ----- | ----------------------------------------------------------------------------------------------- | --------------------------- |
| Cold  | One fresh process per file; first lexer/parser construction occurs in the measured adapter call | `--cold-repeats`, default 3 |
| Warm  | One process, declared warmup calls, then repeated calls on the same source                      | `--iterations`, default 5   |
| Pass  | One process, each selected file once in manifest order, when supported                          | One execution               |

Cold measures first-use adapter cost after process startup and generated-module
loading. Warm measures steady-state parser work. Pass approximates a
single indexing pass but is not a full-build benchmark because the selected
sample is usually smaller than the corpus. An adapter without a shared pass must
label its pass values as per-file.

## Metrics

| Metric              | Definition                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `coreMs`            | Tokenization plus parsing; excludes construction                      |
| `adapterMs`         | Timed in-process adapter call, including construction and bookkeeping |
| `phases.setupMs`    | Lexer, token stream, and parser construction                          |
| `phases.lexerMs`    | Tokenization after construction                                       |
| `phases.sllParseMs` | SLL parse                                                             |
| `phases.llParseMs`  | LL fallback parse, zero when not used                                 |
| `lexerDiagnostics`  | Lexer errors reported through the ANTLR error listener                |
| `parseDiagnostics`  | Parser errors after the selected prediction mode                      |
| `tokens`            | Tokens on the default channel                                         |
| `hiddenTokens`      | Hidden-channel tokens, including comments and whitespace              |
| `prediction`        | `sll`, `sll-fallback-ll`, `ll`, or `unknown`                          |
| `peakRssBytes`      | Process RSS observed at the end of the measured call                  |

`coreMs` deliberately excludes process startup, module import, lexer
construction, parser construction, and generated recognizer initialization.
Construction is reported in `phases.setupMs` and contributes to `adapterMs`.
Lazy first-use initialization may execute inside a constructor and is then
inseparable from construction. Eager generated-module initialization, Node/JVM
startup, and Docker startup occur before the in-process timer and are not
reported as setup or adapter time. This harness does not claim a standalone JVM
startup metric.

## Statistics

The report records count, min, mean, sample standard deviation, coefficient of
variation, deterministic percentile-bootstrap 95% confidence interval for the
mean, p50, p95, p99, and max per adapter and stage.
For a shared pass, the per-file values sum to the pass total. For an adapter
that only supports a per-file pass, the same sum is not a shared-corpus result;
the report labels that difference in the one-pass semantics line.
Percentiles use linear interpolation between order statistics. Every configured
cold repetition is retained for uncertainty reporting; `cold` remains the
per-file median observation for compatibility. Warm values are adapter-produced
medians of the configured in-process samples. A three-repetition bootstrap
interval is descriptive and low-confidence; it must not be presented as a
population guarantee.

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
