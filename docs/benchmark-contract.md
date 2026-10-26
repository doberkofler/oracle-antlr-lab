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

## Selections

Production campaigns must declare one explicit selection mode. The mode, its
source artifact, and a selection fingerprint are written to `selection.json` and
to the report.

| Mode   | Rule                                                                                                               | Default source                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `full` | Every file in the manifest.                                                                                        | The manifest itself                              |
| `q4`   | Largest byte-size quartile using the experiment 003 boundary: `floor(3n/4) … n-1` after sorting by bytes, then id. | `experiments/003-production-scale/report.json`   |
| `tail` | Highest median TypeScript parser-core time; tail-biased by design and not a corpus estimate.                       | `experiments/004-bottleneck-profile/report.json` |

A report-backed selection must reproduce the current manifest. The harness
rejects a source with a different population, a different digest, or a Q4 set
that does not match the manifest boundary. `--selection-source manifest` allows
a Q4 run without a report when the corpus has no promoted artifact; the manifest
digest is then the provenance. The tail source must contain enough ranked files
for the requested `--tail-size`.

The fingerprint is SHA-256 over sorted `file` and `sha256` pairs. Control and
candidate reports can be compared only when their fingerprints match. File
identities, digests, byte sizes, and opaque identifiers are publishable; source
text, original paths, and object names are not.

## Measurement boundaries

- Process, container, and runtime startup occur before the in-process timer.
- Source loading and eager generated-module initialization occur before the
  timer; generated module import is not a measured phase.
- Lexer, token stream, and parser construction are measured in
  `phases.setupMs` and contribute to `adapterMs`.
- Lazy first-use ATN initialization may execute inside construction and is then
  inseparable from `phases.setupMs`.
- `coreMs` begins after construction and covers tokenization plus SLL-first
  parsing and any LL fallback.
- A cache-reuse pass uses one fresh process per repetition and one parser
  instance per file. Generated lexer and parser DFA arrays persist across files
  inside that process; they do not persist across repetitions.
- A pass is not a full build and does not include semantic extraction,
  persistence, or qualification.
- Peak RSS is the process high-water mark, not retained heap after a GC probe.

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

## Comparisons

`pnpm benchmark:compare` compares two campaigns with the same selection
fingerprint. It reports:

- aggregate mean, sample standard deviation, coefficient of variation, and
  deterministic bootstrap 95% confidence interval per pass metric;
- paired per-file deltas over identical files and repetitions, which remove
  file-selection and host-level constant effects;
- LL fallback transitions (`stopped`, `introduced`, `both`, `neither`);
- first-pass diagnostic totals and changed-file counts;
- the recorded machine identity for both campaigns.

Paired deltas require `raw-report.json`. A published `report.json` supports
aggregate comparison only. A negative paired core delta means the candidate is
faster. Pairing does not turn a tail selection into a full-corpus result.

## Comparability rules

1. Same corpus manifest, source digests, and selection fingerprint.
2. Same warmup, iteration, and cold-repetition counts.
3. Same machine class and container limits.
4. Grammar and patch identity recorded.
5. Runtime and generator versions recorded.
6. No result from a superseded report is mixed into a current comparison.

## Memory campaigns

Memory attribution uses the same selections and a separate
[`memory-profiling.md`](./memory-profiling.md) contract. It forces garbage
collection, records retained and allocated bytes, and reports instrumented cost
separately from uninstrumented latency. Instrumented wall time is not a
production benchmark result and must not be compared with a latency report.

## Invalid claims

- Extrapolating a full build from a 15-file pass.
- Reporting a Q4 or tail result as a full-corpus result.
- Comparing control and candidate reports with different selection fingerprints.
- Comparing SLL-only and SLL-first-with-LL-fallback without saying so.
- Comparing forced-GC memory runs with production latency runs.
- Proposing a memory optimization from RSS or a single allocation profile.
- Reporting a speedup from a runtime switch as a grammar improvement.
- Reporting aggregate parser time without lexer and fallback attribution.
- Treating a benchmark pass as semantic correctness.
