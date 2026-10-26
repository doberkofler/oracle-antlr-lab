# Conclusion

**Status:** bottleneck hypothesis confirmed on the selected production tail.

The Java `ProfilingATNSimulator` processed the 12 highest-cost opaque files in
14.515 s inside the container. The three target rules accounted for 9.151 s, or
63.0% of profiled elapsed time.

| Rule                   | Prediction time | Invocations | LL fallbacks | Ambiguities |
| ---------------------- | --------------: | ----------: | -----------: | ----------: |
| `general_element_part` |         4.397 s |     295,857 |        5,268 |           0 |
| `routine_name`         |         2.695 s |      20,066 |        3,154 |       3,154 |
| `general_element`      |         2.058 s |     175,553 |       24,881 |       9,573 |

`general_element_part` is the largest measured prediction consumer and executes
at very high frequency. `routine_name` shows one ambiguity per LL fallback in
this profile. `general_element` has the highest fallback count and 9,573
ambiguities. These measurements confirm that adaptive prediction in core name
and expression rules—not lexer or parser construction—is the primary
optimization target.

Profile instrumentation changes absolute timing, and the 12-file selection is
deliberately tail-biased. Use the event counts and within-profile shares to rank
grammar work; use experiment 003 for uninstrumented production latency and
memory comparisons.
