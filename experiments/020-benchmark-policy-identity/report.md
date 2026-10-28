# Benchmark policy identity and heap preflight

Production reports now state the effective TypeScript harness heap limit and DFA
cache policy, reject knowably unsafe full-corpus configurations before the first
file, and refuse to compare campaigns that differ in either dimension.

## Problem

The official-grammar campaign exhausted Node's default old space near file 1,243
and completed only with `--max-old-space-size=8192`, peaking at 6.546 GB RSS.
Reports recorded the raw `LAB_DFA_CLEAR_EVERY` and `LAB_DFA_MAX_HEAP_MIB` values
but not:

- the effective V8 heap limit of the process that actually parsed the corpus;
- whether the limit came from `NODE_OPTIONS` or the runtime default;
- the selective-eviction settings that also change memory and latency;
- whether two compared campaigns used the same heap or cache policy.

A parent process launched with `node --max-old-space-size=8192` does not pass
that flag to the spawned harness child, so reading the parent limit would be
wrong. The harness child inherits `NODE_OPTIONS`, so that is the setting the
preflight checks.

## Recorded identity

Each production report adds `config.typeScriptPolicy`:

| Field                                       | Meaning                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `heap.limitBytes`, `heap.limitMiB`          | `v8.getHeapStatistics().heap_size_limit` read from a harness-like child |
| `heap.origin`                               | `max-old-space-size` or `v8-default`                                    |
| `heap.maxOldSpaceSizeMiB`                   | Configured old-space value, if any                                      |
| `heap.nodeOptions`                          | Raw `NODE_OPTIONS` text                                                 |
| `dfa.mode`                                  | `persistent`, `periodic-clear`, or `selective-eviction`                 |
| `dfa.clearEveryFiles`, `dfa.clearAtHeapMiB` | Whole-cache clearing settings                                           |
| `dfa.selective`                             | Interval, heap trigger, hot decisions, and per-decision bounds          |
| `fingerprint`                               | SHA-256 over effective heap and cache identity                          |

The fingerprint excludes raw `NODE_OPTIONS` ordering but includes the effective
limit and cache values. Triggers without bounds, or bounds without triggers,
are recorded as `persistent` because no eviction can run.

Reports also record `config.heapSafety` with the preflight findings, the override
flag, `scope: "benchmark"`, and the production guidance. The benchmark heap is
not presented as a production requirement.

## Preflight

The default runtime here reports a 4,192 MiB-effective limit. A full 1,244-file
campaign with the persistent cache was rejected before measurement:

```text
ERROR preflight: persistent DFA cache on 1244 files needs at least 8192 MiB of
V8 heap, but the harness limit is 4192 MiB (v8-default). Set
NODE_OPTIONS=--max-old-space-size=8192 (a parent --max-old-space-size flag is
not inherited by the harness child), or enable a bounded policy with
LAB_DFA_SELECTIVE_EVERY and its bounds, or pass --allow-unsafe-heap to run
anyway. The benchmark never raises the heap automatically.
```

A production-scale selection is at least 1,000 selected files or a full
selection of at least 10 MB. Bounded cache policies need no larger heap because
experiments 017 and 018 completed under the default. A persistent Q4 campaign
below 8,192 MiB warns but proceeds. Tail selections and the 51-file public corpus
remain usable under the default heap.

## Comparison gate

`compareReports` now compares the recorded heap limit and DFA policy:

- same identity: `policy.matches: true`;
- different heap or cache: the comparison throws unless
  `--allow-policy-mismatch` is supplied; an override is recorded as
  `policy.matches: false, policy.overridden: true` and printed in the markdown;
- legacy report without a recorded heap: `policy.matches: null` and the
  markdown states that identity was not recorded rather than assuming equality.

The self-comparison of the public campaign reported a match. An altered copy
with a 4,192 MiB heap was rejected:

```text
Benchmark policy differs: heap limit differs: control 8288 MiB
(max-old-space-size), candidate 4192 MiB (v8-default). Rerun with
--allow-policy-mismatch only when the difference is intended.
```

With the override, the comparison completed and recorded the difference.

## Workflow validation

`NODE_OPTIONS=--max-old-space-size=8192` public full campaign (51 files, one
repetition per adapter) completed and wrote the policy block. Its TypeScript
core was approximately 0.55–0.56 s with 497–498 MB peak RSS across repeated
smoke runs. This is a smoke result for the new report fields, not a performance
claim: it is one repetition and not the production corpus.

## Tests

`test/benchmarkPolicy.test.ts` covers heap-option parsing, default versus
configured origin, persistent/periodic/selective cache identity, fingerprint
stability, preflight error/warning/ok branches, legacy and malformed report
parsing, and policy comparison. `test/comparison.test.ts` covers rejecting a
heap mismatch, rejecting a cache-policy mismatch, recording an override, and
leaving a missing identity unknown. `pnpm verify` passes.

## Threats to validity

- The preflight threshold is derived from the frozen production corpus and the
  experiments 011–019 peak RSS; it is a safety gate, not a memory model.
- `v8.getHeapStatistics().heap_size_limit` includes generations beyond old
  space, so the effective value is larger than the configured old-space size.
- The probe runs a minimal child with the same environment but not the harness
  module, so it measures heap configuration rather than harness allocations.
- Windows and container memory limits were not exercised; the probe reports the
  runtime's own limit rather than inferring it.
- The public smoke campaign is not evidence for a parser optimization.
