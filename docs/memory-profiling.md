# Memory profiling contract

This document defines how the laboratory attributes parser memory. It is
separate from the latency benchmark contract: instrumented memory runs force
garbage collection and must never be compared with production parser timing.

## Question

Which retained and allocated memory sources dominate parser execution, and how
much of the process high-water mark is generated DFA cache, parse-tree and
token retention, or runtime overhead?

An RSS observation alone is not evidence for an optimization. A memory claim
requires the measurements below on the same frozen selection used by the
latency benchmark.

## Selections

`pnpm profile:memory` reuses the audited selections from
[`benchmark-contract.md`](./benchmark-contract.md):

- `full`: every manifest file.
- `q4`: largest byte-size quartile.
- `tail`: highest median TypeScript parser-core files.

The selection fingerprint must match the latency campaign for a related
result. Memory results are not a substitute for full-corpus validation of a
latency change.

## Node.js tooling

| Measurement                 | Method                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Retained heap               | `process.memoryUsage()` after two forced `global.gc()` calls; the harness runs with `--expose-gc`.          |
| DFA cache                   | Difference between the retained end state and the state after clearing every generated decision DFA.        |
| Base runtime                | Retained heap after the last parser and token stream are dropped.                                           |
| Parse-tree retention        | Representative file held in stages: tree, then source, then token stream dropped.                           |
| Allocation volume and sites | `inspector` `HeapProfiler.startSampling` with a 32 KiB sampling interval; profile summarized by call frame. |
| Per-file growth             | Retained heap checkpoints every `--gc-every` files, plus DFA state counts after every file.                 |
| High-water mark             | `process.resourceUsage().maxRSS` recorded before profiles and reports are written.                          |

V8 `.heapsnapshot` capture was evaluated and rejected for this corpus. A
12-file tail snapshot was 2.7 GB, exceeded the in-process read limit, and would
have required a streaming parser for shallow self-size attribution. Forced-GC
deltas give the retained ownership split without that cost.

The memory harness raises the V8 old-space cap to 8 GB so the full corpus fits.
That changes GC thresholds relative to the default production run; compare
memory passes with other memory passes, not with latency passes.

## Java tooling

| Measurement             | Method                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Retained heap           | `MemoryMXBean.getHeapMemoryUsage()` after `System.gc()`.                                                                    |
| DFA cache               | Difference between the retained end state and the state after `clearDFA()`.                                                 |
| Base runtime            | Retained heap after the last parser and token stream are dropped.                                                           |
| Parse-tree retention    | Representative file held in stages; the parser is dropped before the tree so `Parser.getContext()` does not mask the delta. |
| Live-object attribution | `jcmd <pid> GC.class_histogram -all` parsed into parser categories.                                                         |
| Allocation volume       | `com.sun.management.ThreadMXBean.getCurrentThreadAllocatedBytes()`.                                                         |
| High-water mark         | `/proc/self/status` `VmHWM`.                                                                                                |

The class histogram reports shallow live bytes per class. Arrays, hash maps, and
JVM filler are visible but are not attributed to a parser owner when the runtime
does not expose that ownership.

## Overhead accounting

Every selection is run once without instrumentation and once or more with
instrumentation. Reports keep these values in separate columns and compute
percent change only inside the instrumented category.

- Forced GC, allocation sampling, and class histograms change wall time.
- An instrumented wall time is not a production benchmark result.
- Sampling allocation bytes are estimates; Java thread allocation bytes are
  cumulative allocation, not retained memory.
- At least two instrumented repeats are required for `q4` and `tail`; the full
  corpus may use one repeat because of cost. Repeat agreement is the relative
  spread of retained DFA bytes.

## Interpretation rules

- DFA cache growth is a retained-memory result; it is not evidence that clearing
  the cache would improve latency.
- Parse-tree and token retention for one representative file is not a corpus
  average.
- A dominant allocation site is a candidate for inspection, not an optimization
  proposal.
- No optimization may be proposed from RSS observations alone.
- A memory optimization requires its own control and candidate campaign on the
  same selection and a latency result that does not regress.

## Publication

Only aggregate bytes, opaque file identities, byte sizes, timings, profiler
counts, class names, module-relative script paths, and evidence digests enter a
promoted report. Raw heap profiles, class histograms, and snapshots stay under
`results/`, which is ignored.

`--publish` rejects a report containing the workspace path, `/Users/`,
`/private/`, `/corpus/`, `.work/`, or a `file://` URL. No source text, original
path, object name, or credential is published.

## Command

```bash
pnpm profile:memory -- --selection all --experiment 008-memory-profile \
  --publish experiments/008-memory-profile
```

Useful overrides:

```bash
pnpm profile:memory -- --selection q4 --repeats 2
pnpm profile:memory -- --selection tail --adapter typescript --gc-every 10
pnpm profile:memory -- --selection full --full-repeats 1 --no-allocation
pnpm profile:memory -- --dry-run --selection q4
```
