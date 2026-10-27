# Oracle ANTLR Lab

Reproducible experiments for the Oracle PL/SQL ANTLR grammar.

This repository measures the parser, not the semantic indexer. It exists to
answer questions such as:

- Which grammar decisions dominate prediction time?
- How often does SLL parsing need an LL fallback, and what does that cost?
- Which valid production constructs still fail to parse?
- Does error recovery amplify the cost of a grammar gap?
- Does a runtime or target change improve the constant factor?
- Does a grammar change improve acceptance without regressing prediction cost?

It does **not** implement an Oracle symbol index, PL/Scope qualification, or a
production adapter. Those remain in
[`codeindex-mcp`](https://github.com/doberkofler/codeindex-mcp).

Start with the [problem register](docs/problem-register.md) for the retained
performance and quality facts, then use the
[benchmark contract](docs/benchmark-contract.md) before comparing runs.

## Non-goals

- No claim that parser speed alone justifies production adoption.
- No private source publication. Private corpora stay outside this repository;
  only hashes and aggregates leave the source owner.
- No semantic reference or dependency resolver.
- No generated-parser commits.

## Quick start

```bash
pnpm install
pnpm grammar:download
pnpm grammar:generate
pnpm benchmark:quick
```

`pnpm grammar:download` fetches the pinned `antlr/grammars-v4` commit and
verifies every upstream digest before adding the TypeScript target imports.
The pinned identity and adaptation list are written to `grammar/pin.json`.

`pnpm benchmark:quick` runs 15 files from the public synthetic corpus with one
cold repetition. Full defaults use three cold repetitions, one warmup, and five
warm samples per file.

Production selections use one explicit mode:

```bash
pnpm benchmark:production -- --selection full --experiment 008-full
pnpm benchmark:production -- --selection q4 --experiment 008-q4
pnpm benchmark:production -- --selection tail --tail-size 12 --experiment 008-tail
pnpm benchmark:compare -- --control results/008-control/raw-report.json \
  --candidate results/008-candidate/raw-report.json --experiment 008-compare
```

Q4 reproduces the experiment 003 byte-size boundary from
`experiments/003-production-scale/report.json`. The 12-file tail reproduces the
ranking in `experiments/004-bottleneck-profile/report.json`. Both write
`selection.json` with the source digest, selected hashes, and a selection
fingerprint. Add `--dry-run` to resolve and print a selection without starting a
campaign. Comparison rejects different fingerprints and reports paired per-file
deltas. Full-corpus validation remains required before accepting an optimization.

Memory attribution is a separate instrumented campaign:

```bash
pnpm profile:memory -- --selection all --experiment 008-memory-profile \
  --publish experiments/008-memory-profile
```

It measures retained heap after forced GC, DFA cache retention, parse-tree and
token retention, allocation volume and sites, and per-file DFA growth for the
same `full`, `q4`, and `tail` selections. Instrumented wall time is reported
separately from uninstrumented timing and is never a production benchmark
result. See [`docs/memory-profiling.md`](docs/memory-profiling.md).

Semantic conformance is a separate acceptance gate:

```bash
pnpm conformance -- --manifest .work/private-production/manifest.json \
  --experiment 009-semantic-conformance \
  --publish experiments/009-semantic-conformance
```

It generates each optimization state independently and compares accepted units,
structural parse trees, tokens, diagnostics, and recovery behavior. A
performance result without a passing per-change conformance result is
incomplete. See
[`docs/semantic-conformance.md`](docs/semantic-conformance.md).

Java qualification uses a cross-runtime structural gate:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm conformance:cross-runtime \
  .work/private-production/manifest.json java-requalification
```

The gate applies the production conditional-compilation boundary before Java
receives the source, matching the TypeScript input contract. Token-level
divergence is diagnosable without publishing token text:

```bash
pnpm diagnose:cross-runtime .work/private-production/manifest.json \
  java-token-diagnosis raw
```

Memory-constrained experiments can set `LAB_DFA_CLEAR_EVERY` or
`LAB_DFA_MAX_HEAP_MIB`. Both clear the complete parser DFA and are deliberately
opt-in: measured policies reduced RSS but regressed latency substantially.

## What is measured

`coreMs` is tokenization plus parsing. It excludes lexer/parser construction,
conditional compilation preparation, semantic visitors, generated-module
loading, and process startup. `phases.setupMs` records construction. Lazy ATN
initialization may be inseparable from first construction; eager initialization
and Node/JVM startup occur before the timer and are not claimed as measured.

`adapterMs` is the timed in-process call around the same source, including
construction but excluding process/container startup, source loading, and eager
generated-module initialization. Cold `adapterMs` is first-use adapter cost, not
whole-process cold-start cost.

The runner records:

- cold distribution across fresh processes;
- warm distribution after a declared warmup count;
- a cache-reuse pass in one process; parser instances are per file while the
  generated lexer/parser DFA arrays persist across files;
- lexer and parser diagnostics;
- visible and hidden token counts;
- SLL/LL fallback behavior;
- peak process RSS.

Separate conformance runs record accepted-unit counts, structural parse-tree
digests, diagnostics digests, and recovery behavior. They do not extract
declarations, references, or dependencies; identical parse trees are the
available semantic boundary. Java is not semantic acceptance evidence until it
owns a standalone conditional-compilation boundary; with the shared boundary all
1,244 production files pass structural conformance.

The one-pass value is a sample approximation, not a full production build. Do
not extrapolate without a full-corpus manifest and an external decision report.

## Repository layout

| Path                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `grammar/`            | Pinned upstream sources, reviewed patches, generated TypeScript output     |
| `corpora/public/`     | Deterministic, redistributable source corpus                               |
| `src/`                | Corpus manifest handling, statistics, runner, report assembly              |
| `scripts/`            | Download, generation, corpus selection, benchmark, conformance entrypoints |
| `grammar/typescript/` | TypeScript parser harness                                                  |
| `java/`               | Java target harness, built in Docker                                       |
| `experiments/`        | Promoted experiment records and conclusions                                |
| `docs/`               | Benchmark, memory, conformance, and corpus contracts                       |
| `test/`               | Unit tests for lab infrastructure                                          |

## Corpora

The public corpus is generated from `scripts/make-public-corpus.ts`. It contains
synthetic packages, nested blocks, CASE expressions, loops, conditional
compilation, and alternative-quoted strings. It is redistributable but is not a
representative production workload.

Private corpora use opaque file identities in the same manifest format:

```bash
pnpm corpus:select \
  --root /path/to/oracle/source \
  --output /path/to/private-corpus \
  --id private-production \
  --visibility private \
  --files 40
```

The manifest records opaque identities, byte sizes, and SHA-256 digests. Original
relative paths are neither copied into the manifest nor used as copied filenames.
Do not commit a private corpus or a report that contains private paths. See
[`docs/corpus-format.md`](docs/corpus-format.md).

## Adapters

The TypeScript adapter is the primary target. It runs the actual `antlr4ng`
runtime against generated recognizers from the pinned grammar. `parseSource`
retains the complete parse state for compatibility; `parseSourceStreaming`
provides transaction-safe listener extraction without retaining a tree.

The Java adapter uses an official ANTLR target in a Docker image. Its pass runs
all selected files in one JVM with a parser instance per file. Generated static
lexer/parser DFA caches persist across those instances. Reports call this a
cache-reuse pass rather than implying parser-instance reuse.

## Experiment protocol

Every experiment must declare:

1. the question and hypothesis;
2. the corpus id, selection, and control;
3. grammar, generator, runtime, and patch identities;
4. warmup, iteration, and cold-repetition counts;
5. acceptance criteria;
6. the result and the decision.

Only then promote `results/<name>/report.{json,md}` into
`experiments/<name>/` and write the conclusion. Do not keep a result that
contradicts the hypothesis without recording why.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Generated parsers are reproducible. Regenerate them after changing a grammar
patch; never edit generated output.
