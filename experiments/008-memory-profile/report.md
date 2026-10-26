# 008-memory-profile

Corpus private-production-20261027: 1244 source files, 20.9 MB. Generated 2026-10-26T21:09:01.439Z.

Instrumented intervals are reported separately from uninstrumented parser timing. They are not comparable production benchmarks.

## tail

12 opaque files, 2.7 MB; selection b32a43a1f03ae4c4…; source experiments/004-bottleneck-profile/report.json.

| Adapter    | Files | Core mean ms | Instrumented elapsed mean s | Elapsed overhead | Startup retained | Retained end | DFA cache retained | DFA share | Base retained after parser drop | DFA states first → last | Peak RSS | Dominant retained category | DFA repeat agreement | Allocation repeat agreement |
| ---------- | ----: | -----------: | --------------------------: | ---------------: | ---------------: | -----------: | -----------------: | --------: | ------------------------------: | ----------------------: | -------: | -------------------------- | -------------------: | --------------------------: |
| typescript |    12 |    45486.520 |                      45.796 |            53.5% |          57.8 MB |      1.44 GB |            1.32 GB |    91.24% |                        126.6 MB |            5056 → 52096 |  2.33 GB | —                          |                0.00% |                       0.45% |
| java       |    12 |    12749.906 |                      14.516 |             2.6% |           1.3 MB |     875.9 MB |           786.5 MB |    89.79% |                         64.0 MB |            5575 → 39800 |  2.02 GB | atn-dfa (84.83%)           |                0.02% |                           — |

| Adapter    | Representative file | Parse tree | Token stream | Source text | Sampled allocations | Allocation source         |
| ---------- | ------------------- | ---------: | -----------: | ----------: | ------------------: | ------------------------- |
| typescript | source-001243.pkb   |    43.4 MB |      12.0 MB |    370.0 kB |             1.40 GB | v8-sampling-heap-profiler |
| java       | source-001243.pkb   |    24.2 MB |       1.7 MB |    370.0 kB |            35.48 GB | jvm-thread-allocation     |

### tail typescript top allocation sites

| Function                | Script                                                                  | Sampled bytes |
| ----------------------- | ----------------------------------------------------------------------- | ------------: |
| getEpsilonTarget        | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       1.04 GB |
| add                     | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |      141.7 MB |
| <anonymous>             | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       59.1 MB |
| precedenceTransition    | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       34.3 MB |
| enterRule               | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       16.6 MB |
| addDFAEdge              | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       13.9 MB |
| nextToken               | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       11.9 MB |
| computeReachSet         | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        7.8 MB |
| createWithContext       | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        7.3 MB |
| computeTargetState      | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        6.8 MB |
| slice                   | (native)                                                                |        5.8 MB |
| _ParserRuleContext      | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        5.6 MB |
| _ArrayPredictionContext | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        5.1 MB |
| match                   | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        5.0 MB |
| unrollRecursionContexts | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        4.8 MB |

### tail java retained categories

| Category   |    Bytes |  Share |  Objects |
| ---------- | -------: | -----: | -------: |
| parse-tree |   7.8 MB |  0.89% |   209257 |
| tokens     |   3.4 MB |  0.39% |    71315 |
| atn-dfa    | 743.9 MB | 84.82% | 11780357 |
| containers | 108.2 MB | 12.34% |  1309086 |
| strings    | 462.5 kB |  0.05% |    19269 |
| runtime    |   9.1 MB |  1.04% |    12125 |
| other      |   4.2 MB |  0.47% |   135004 |

Uninstrumented overhead reference:

| Adapter    | Uninstrumented elapsed s | Instrumented elapsed s | Elapsed change | Uninstrumented core ms | Instrumented core ms | Core change |
| ---------- | -----------------------: | ---------------------: | -------------: | ---------------------: | -------------------: | ----------: |
| typescript |                   29.826 |                 45.796 |          53.5% |              29777.309 |            45486.520 |       52.8% |
| java       |                   14.155 |                 14.516 |           2.6% |              12694.507 |            12749.906 |        0.4% |

## q4

311 opaque files, 16.5 MB; selection 276f71f68eb1770e…; source experiments/003-production-scale/report.json.

| Adapter    | Files | Core mean ms | Instrumented elapsed mean s | Elapsed overhead | Startup retained | Retained end | DFA cache retained | DFA share | Base retained after parser drop | DFA states first → last | Peak RSS | Dominant retained category | DFA repeat agreement | Allocation repeat agreement |
| ---------- | ----: | -----------: | --------------------------: | ---------------: | ---------------: | -----------: | -----------------: | --------: | ------------------------------: | ----------------------: | -------: | -------------------------- | -------------------: | --------------------------: |
| typescript |   311 |   121641.170 |                     125.614 |            51.7% |          57.7 MB |      3.29 GB |            3.16 GB |    95.95% |                        133.2 MB |             89 → 130907 |  4.74 GB | —                          |                0.00% |                       0.36% |
| java       |   311 |    36853.140 |                      42.873 |            14.5% |           1.4 MB |      2.56 GB |            2.36 GB |    92.25% |                        173.0 MB |             89 → 122638 |  4.46 GB | atn-dfa (87.53%)           |                0.01% |                           — |

| Adapter    | Representative file | Parse tree | Token stream | Source text | Sampled allocations | Allocation source         |
| ---------- | ------------------- | ---------: | -----------: | ----------: | ------------------: | ------------------------- |
| typescript | source-001243.pkb   |    43.4 MB |      12.0 MB |    370.0 kB |             3.22 GB | v8-sampling-heap-profiler |
| java       | source-001243.pkb   |    23.8 MB |       1.8 MB |    370.0 kB |            98.60 GB | jvm-thread-allocation     |

### q4 typescript top allocation sites

| Function                | Script                                                                  | Sampled bytes |
| ----------------------- | ----------------------------------------------------------------------- | ------------: |
| getEpsilonTarget        | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       2.54 GB |
| add                     | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |      219.4 MB |
| closure_                | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |      122.4 MB |
| precedenceTransition    | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       84.0 MB |
| <anonymous>             | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       57.4 MB |
| addDFAEdge              | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       29.3 MB |
| computeReachSet         | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       23.5 MB |
| createWithContext       | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       20.2 MB |
| slice                   | (native)                                                                |       18.7 MB |
| enterRule               | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       14.7 MB |
| _ArrayPredictionContext | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       14.4 MB |
| computeTargetState      | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       13.9 MB |
| nextToken               | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       11.1 MB |
| consume                 | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        5.5 MB |
| unrollRecursionContexts | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        5.3 MB |

### q4 java retained categories

| Category   |    Bytes |  Share |  Objects |
| ---------- | -------: | -----: | -------: |
| parse-tree |   7.8 MB |  0.30% |   209257 |
| tokens     |   3.4 MB |  0.13% |    71315 |
| atn-dfa    |  2.24 GB | 87.53% | 33733086 |
| containers | 281.3 MB | 10.98% |  3085445 |
| strings    | 477.3 kB |  0.02% |    19887 |
| runtime    |  22.1 MB |  0.86% |    21654 |
| other      |   4.3 MB |  0.17% |   140468 |

Uninstrumented overhead reference:

| Adapter    | Uninstrumented elapsed s | Instrumented elapsed s | Elapsed change | Uninstrumented core ms | Instrumented core ms | Core change |
| ---------- | -----------------------: | ---------------------: | -------------: | ---------------------: | -------------------: | ----------: |
| typescript |                   82.777 |                125.614 |          51.7% |              82503.694 |           121641.170 |       47.4% |
| java       |                   37.441 |                 42.873 |          14.5% |              35966.920 |            36853.140 |        2.5% |

## full

1244 opaque files, 20.9 MB; selection dc595c376242f224…; source private manifest (path withheld).

| Adapter    | Files | Core mean ms | Instrumented elapsed mean s | Elapsed overhead | Startup retained | Retained end | DFA cache retained | DFA share | Base retained after parser drop | DFA states first → last | Peak RSS | Dominant retained category | DFA repeat agreement | Allocation repeat agreement |
| ---------- | ----: | -----------: | --------------------------: | ---------------: | ---------------: | -----------: | -----------------: | --------: | ------------------------------: | ----------------------: | -------: | -------------------------- | -------------------: | --------------------------: |
| typescript |  1244 |   133982.158 |                     141.218 |            57.2% |          57.7 MB |      3.60 GB |            3.46 GB |    96.26% |                        134.3 MB |             92 → 144332 |  4.84 GB | —                          |                    — |                           — |
| java       |  1244 |    38709.321 |                      49.902 |            24.6% |           1.5 MB |      2.83 GB |            2.61 GB |    92.40% |                        189.3 MB |             92 → 136414 |  4.47 GB | atn-dfa (87.87%)           |                    — |                           — |

| Adapter    | Representative file | Parse tree | Token stream | Source text | Sampled allocations | Allocation source         |
| ---------- | ------------------- | ---------: | -----------: | ----------: | ------------------: | ------------------------- |
| typescript | source-001243.pkb   |    43.5 MB |      12.0 MB |    370.0 kB |             3.55 GB | v8-sampling-heap-profiler |
| java       | source-001243.pkb   |    23.8 MB |       1.8 MB |    370.0 kB |           106.51 GB | jvm-thread-allocation     |

### full typescript top allocation sites

| Function                | Script                                                                  | Sampled bytes |
| ----------------------- | ----------------------------------------------------------------------- | ------------: |
| getEpsilonTarget        | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       2.82 GB |
| add                     | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |      357.6 MB |
| precedenceTransition    | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       98.8 MB |
| <anonymous>             | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       64.7 MB |
| addDFAEdge              | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       30.2 MB |
| slice                   | (native)                                                                |       20.9 MB |
| createWithContext       | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       20.8 MB |
| computeReachSet         | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       19.3 MB |
| computeTargetState      | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       17.3 MB |
| _ArrayPredictionContext | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       16.9 MB |
| enterRule               | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       15.0 MB |
| nextToken               | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |       11.0 MB |
| ATNConfigSet            | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        6.6 MB |
| unrollRecursionContexts | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        6.1 MB |
| _ParserRuleContext      | node_modules/.pnpm/antlr4ng@3.0.16/node_modules/antlr4ng/dist/index.mjs |        5.5 MB |

### full java retained categories

| Category   |    Bytes |  Share |  Objects |
| ---------- | -------: | -----: | -------: |
| parse-tree |   7.8 MB |  0.27% |   209257 |
| tokens     |   3.4 MB |  0.12% |    71315 |
| atn-dfa    |  2.49 GB | 87.87% | 37241762 |
| containers | 307.5 MB | 10.87% |  3382601 |
| strings    | 522.1 kB |  0.02% |    21756 |
| runtime    |  19.7 MB |  0.70% |    18260 |
| other      |   4.3 MB |  0.15% |   141871 |

Uninstrumented overhead reference:

| Adapter    | Uninstrumented elapsed s | Instrumented elapsed s | Elapsed change | Uninstrumented core ms | Instrumented core ms | Core change |
| ---------- | -----------------------: | ---------------------: | -------------: | ---------------------: | -------------------: | ----------: |
| typescript |                   89.828 |                141.218 |          57.2% |              89626.158 |           133982.158 |       49.5% |
| java       |                   40.035 |                 49.902 |          24.6% |              38555.574 |            38709.321 |        0.4% |

## Method

- **v8-sampling-heap-profiler:** inspector HeapProfiler sampling; interval 32768 bytes; allocation volume, not retained bytes.
- **v8-retained-deltas:** forced-GC heap deltas; DFA table clear and staged reference drop.
- **jvm-class-histogram:** jcmd GC.class_histogram -all after forced GC; live instances and shallow bytes by class.
- **jvm-thread-allocation:** com.sun.management.ThreadMXBean.getCurrentThreadAllocatedBytes; cumulative allocated bytes, not retained bytes.

Retained memory is measured after forced garbage collection. DFA cache retained bytes are the difference between the retained end state and the state after clearing the generated DFA tables. Per-file retention parses one representative file, then drops the parse tree, source text, and token stream in stages. Java drops the parser before the tree because `Parser.getContext()` retains the root context; its token figure therefore includes the parser frame released with the stream.

Peak RSS is the process high-water mark recorded before heap snapshots, profiles, or reports are written. Class histogram self sizes are shallow and are not dominator-retained sizes; generic containers and runtime internals are not attributed to a parser owner.

## Limitations

- V8 heap snapshots were rejected for this corpus: a 12-file tail snapshot was 2.7 GB and exceeded in-process read limits, so forced-GC byte deltas replace snapshot attribution.
- Generic arrays, maps, and runtime internals are not attributed to a parser owner when the profiler does not expose ownership.
- Sampling allocation profiles estimate volumes from a sampling interval; they do not enumerate every allocation.
- Forced garbage collection changes wall time and must not be compared with production benchmark results.
- JVM class histograms describe live objects at one instant; JIT and GC metadata are outside the Java heap histogram.
- One representative file isolates parse-tree, source-text, and token-stream retention; it is not a corpus average.
- No optimization is proposed from these measurements alone.
