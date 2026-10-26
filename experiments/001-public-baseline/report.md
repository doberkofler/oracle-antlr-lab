# 001-public-baseline

A reproducible baseline on the public corpus separates parser work, construction, JVM startup, and SLL fallback.

Generated 2026-10-26T09:47:35.080Z

Corpus: public-synthetic — 48 of 48 files, Size quantiles over 48 files; 48 selected.

| Adapter    | Cold core p50 ms | Cold adapter p50 ms | Cold setup p50 ms | Warm core p50 ms | Pass core sum ms | Failures |
| ---------- | ---------------: | ------------------: | ----------------: | ---------------: | ---------------: | -------: |
| typescript |           63.402 |              63.901 |             0.223 |            0.747 |          378.776 |        0 |
| java       |           71.433 |            1516.505 |          1444.112 |            0.326 |          245.610 |        0 |

One-pass semantics: typescript — one process, shared DFA across selected files; java — one JVM over selected files; parser instance per file.

Treat every one-pass total as an approximation, not a full-build benchmark.

Environment: Apple M5 Max, 18 logical CPUs, darwin/arm64, Node v26.10.0.
