# Conclusion

**Status:** accepted.

The experiment attributes the parser memory high-water mark on the frozen
1,244-file corpus and its derived Q4 and tail selections. Instrumented memory
runs force garbage collection and are not latency results.

## Retained memory

Retained heap is dominated by generated decision DFA state, not by parse trees
or token streams that survive a cache-reuse pass.

| Selection    | Adapter    | Retained end | DFA cache retained | DFA share | Base after parser drop | DFA states | Peak RSS |
| ------------ | ---------- | -----------: | -----------------: | --------: | ---------------------: | ---------: | -------: |
| Tail (12)    | TypeScript |      1.44 GB |            1.32 GB |    91.24% |               126.6 MB |     52,096 |  2.33 GB |
| Tail (12)    | Java       |     875.9 MB |           786.5 MB |    89.79% |                64.0 MB |     39,800 |  2.02 GB |
| Q4 (311)     | TypeScript |      3.29 GB |            3.16 GB |    95.95% |               133.2 MB |    130,907 |  4.74 GB |
| Q4 (311)     | Java       |      2.56 GB |            2.36 GB |    92.25% |               173.0 MB |    122,638 |  4.46 GB |
| Full (1,244) | TypeScript |      3.60 GB |            3.46 GB |    96.26% |               134.3 MB |    144,332 |  4.84 GB |
| Full (1,244) | Java       |      2.83 GB |            2.61 GB |    92.40% |               189.3 MB |    136,414 |  4.47 GB |

The Java class histogram independently attributes 84.83% of live shallow bytes
to ATN/DFA classes on the tail, 87.53% on Q4, and 87.87% on the full corpus.
Parse-tree classes are 0.27–0.89% and token classes are 0.12–0.39%; the rest is
mostly generic containers and runtime internals.

## Parse-tree and token retention

One representative file (`source-001243.pkb`, 370.0 kB) was held in stages after
the DFA tables were cleared.

| Adapter    |   Parse tree | Token stream | Source text |
| ---------- | -----------: | -----------: | ----------: |
| TypeScript |      43.4 MB |      12.0 MB |    370.0 kB |
| Java       | 23.8–24.2 MB |   1.7–1.8 MB |    370.0 kB |

These values are per-file retention, not a corpus average. They are an order of
magnitude smaller than the retained DFA cache and do not accumulate across
files in a cache-reuse pass.

## Allocation

TypeScript allocation sampling attributes the dominant sampled volume to
`getEpsilonTarget` in the pinned `antlr4ng` runtime:

| Selection | Total sampled | `getEpsilonTarget` | Share | Next largest    |
| --------- | ------------: | -----------------: | ----: | --------------- |
| Tail      |       1.40 GB |            1.04 GB |   74% | `add`, 141.7 MB |
| Q4        |       3.22 GB |            2.55 GB |   79% | `add`, 216.7 MB |
| Full      |       3.55 GB |            2.82 GB |   79% | `add`, 368.4 MB |

Java reports 35.48 GB, 98.60 GB, and 106.51 GB of cumulative thread allocation
for the same selections. It does not provide a per-site breakdown in this
harness; the cumulative volume is evidence of allocation churn, not of a
retained owner.

The dominant TypeScript allocation result is verified across the two Q4
repeats (0.36% relative spread) and the two tail repeats (0.45%). Retained DFA
bytes agree within 0.00–0.02%.

## Profiler overhead

| Selection | TypeScript core change | Java core change |
| --------- | ---------------------: | ---------------: |
| Tail      |                 +52.8% |            +0.4% |
| Q4        |                 +47.4% |            +2.5% |
| Full      |                 +49.5% |            +0.4% |

Node sampling roughly doubles parser core in the instrumented interval. Java
thread allocation accounting and the final class histogram add little core
time. Wall overhead is larger where the sampling profile is written. No
instrumented time in this experiment is a production benchmark.

## Decision

The dominant retained owner is the generated DFA cache: 90–96% of retained heap
across both runtimes and all three selections. Parse-tree and token retention
are released per file and remain far smaller. TypeScript allocation volume is
dominated by ATN epsilon-closure work in `getEpsilonTarget`.

No optimization is proposed from these observations. Any cache, allocation, or
GC change requires a paired control and candidate campaign on the same
selection, unchanged diagnostics and parse-tree digests, and a latency result
that does not regress. A memory win that trades cache size for prediction work
must be measured as a latency trade-off, not inferred from RSS.

## Threats to validity

- V8 heap snapshots were rejected: a 12-file tail snapshot was 2.7 GB and
  exceeded in-process read limits. Forced-GC byte deltas replace snapshot
  attribution.
- The Node memory harness uses an 8 GB old-space cap, changing GC thresholds
  relative to the default production run.
- JVM class histograms report shallow live bytes; arrays and hash maps are not
  attributed to a parser owner.
- Sampling allocation volumes are estimates; Java thread allocation is
  cumulative allocation, not retained memory.
- Forced collection changes wall time and can produce small negative apparent
  overhead on a noisy run.
- Q4 and tail are inherited selections; only the full corpus covers the
  population.
- One representative file isolates tree, source, and token retention; it is not
  a corpus average.
