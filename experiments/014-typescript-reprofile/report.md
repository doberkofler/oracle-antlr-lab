# Optimized TypeScript profile

The 12-file highest-cost tail completed in 36.085 s under `ProfilingATNSimulator`; 34.041 s was attributed to adaptive prediction.

| Rank | Rule                    | Prediction time | Share | Invocations | SLL ATN transitions | Runtime LL fallbacks |
| ---: | ----------------------- | --------------: | ----: | ----------: | ------------------: | -------------------: |
|    1 | `general_element_part`  |        16.669 s | 49.0% |      78,460 |              52,221 |                  767 |
|    2 | `general_element`       |         6.897 s | 20.3% |      25,267 |               4,582 |                1,986 |
|    3 | `unary_expression_core` |         3.996 s | 11.7% |      53,968 |               5,714 |                  174 |
|    4 | `statement`             |         1.086 s |  3.2% |      15,386 |               4,713 |                   73 |
|    5 | `atom`                  |         0.914 s |  2.7% |      89,372 |               1,054 |                  262 |

The top decision remains decision 2993 in `general_element_part`: 16.669 s and 52,174 SLL ATN transitions. Decisions 2990 and 2989 in `general_element` together account for 6.897 s.

## Threats to validity

- Profiling instrumentation changes absolute latency; rankings and transition counts are the useful outputs.
- The selection is intentionally tail-biased and does not estimate whole-corpus shares.
- Runtime LL fallback counts are per adaptive decision and are distinct from the harness's full-file fallback policy.
