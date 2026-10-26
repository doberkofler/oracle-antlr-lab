# 002-stable-public-baseline

Three cold repetitions quantify baseline variance for both adapters on all 48 public files.

Generated 2026-10-26T11:40:03.468Z

Corpus: public-synthetic — 48 of 48 files, Size quantiles over 48 files; 48 selected.

| Adapter    | Cold campaign core mean ms [bootstrap 95% CI] | Campaign CV | Cold file core p50 ms | Cold adapter p50 ms | Cold construction p50 ms | Warm core p50 ms | Cache-reuse pass core sum ms | Failures |
| ---------- | --------------------------------------------: | ----------: | --------------------: | ------------------: | -----------------------: | ---------------: | ---------------------------: | -------: |
| typescript |                 5314.789 [5241.617, 5387.580] |       1.37% |                74.507 |              75.065 |                    0.248 |            0.923 |                      464.815 |        0 |
| java       |                 5123.846 [5074.846, 5189.994] |       1.16% |                89.668 |            1617.860 |                 1503.180 |            0.534 |                      271.650 |        0 |

Cache-reuse pass semantics: typescript — one process; parser instances are per file; generated lexer/parser DFA caches persist across files; java — one JVM; parser instances are per file; generated lexer/parser DFA caches persist across files.

Treat every one-pass total as an approximation, not a full-build benchmark.

Environment: Apple M5 Max, 18 logical CPUs, darwin/arm64, Node v26.10.0.
