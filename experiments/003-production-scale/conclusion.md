# Conclusion

**Status:** historical latency and memory result reproduced. Full-parser adoption
remains rejected on performance evidence alone.

## Result

Three fresh-process cache-reuse passes parsed all 1,244 opaque files
(20,944,414 bytes).

| Adapter                 | Wall mean | Wall CV | Core mean | Bootstrap 95% CI (wall) | Peak RSS max | LL fallback files | Diagnostics |
| ----------------------- | --------: | ------: | --------: | ----------------------: | -----------: | ----------------: | ----------: |
| TypeScript (`antlr4ng`) | 157.456 s |   9.90% | 156.093 s |    [146.855, 175.355] s |     4.710 GB |               129 |         181 |
| Java (`antlr4-runtime`) |  42.143 s |   0.79% |  40.106 s |      [41.892, 42.521] s |     4.418 GB |               150 |         486 |

The TypeScript result reproduces the historical ANTLR observation of 147.134 s
parser time and 5.018 GB peak RSS: current parser time is 6.1% higher and peak
RSS is 6.1% lower on a corpus that is 0.6% larger by bytes.

Against the retained current structural baseline on the same machine and frozen
corpus, TypeScript parser core alone is 17.36× the 8.994 s full-rebuild build
stage and 10.57× the 14.766 s cold-build stage. These are conservative,
non-phase-identical comparisons because the structural values include work not
present in parser core. The order-of-magnitude slowdown is therefore reproduced,
not rejected.

Java is 3.89× faster than TypeScript parser core but is not an equivalent
acceptance result: it uses the unmodified upstream target and retains 486
diagnostics after LL fallback. Runtime replacement changes the constant factor;
it does not establish semantic viability.

## Size stratification

| TypeScript stratum | Files |    Byte range | Core mean | Share of total core | LL fallback files |
| ------------------ | ----: | ------------: | --------: | ------------------: | ----------------: |
| Q1 smallest        |   311 |  115 B–2.1 kB |   1.897 s |                1.2% |                 0 |
| Q2                 |   311 |    2.1–5.2 kB |   3.543 s |                2.3% |                 6 |
| Q3                 |   311 |   5.2–16.8 kB |  19.449 s |               12.5% |                29 |
| Q4 largest         |   311 | 17.0–370.0 kB | 131.205 s |               84.1% |                94 |

The largest quartile dominates. File count and median latency alone would hide
the production tail.

## Phase attribution

TypeScript mean phase totals:

| Phase              |     Mean | Share of parser core |
| ------------------ | -------: | -------------------: |
| Construction/setup |  0.116 s |                0.07% |
| Lexer              |  0.688 s |                0.44% |
| SLL parse          | 85.021 s |               54.47% |
| LL fallback parse  | 70.384 s |               45.09% |

Construction and lexing are not the bottleneck. LL fallback occurs in only
10.4% of files but consumes 45.1% of parser core. SLL prediction remains 54.5%,
so removing fallback alone cannot make the parser competitive.

## Privacy and confidence

The committed report contains opaque identities, hashes, byte/line counts, and
measurements only. An automated audit found zero original relative/basename
matches and no absolute private root. Raw per-file repetitions remain under the
ignored `results/` tree; the promoted JSON retains the opaque manifest and
aggregate/run summaries.

Three repetitions give low-confidence bootstrap intervals. TypeScript wall CV
is 9.90%, driven mainly by the first pass; repeat before evaluating a small
optimization.
