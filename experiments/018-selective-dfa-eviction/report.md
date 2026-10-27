# Selective DFA eviction

The complete 1,244-file opaque corpus now finishes under Node's default heap with
per-decision eviction instead of whole-cache clearing.

| Policy                          |     Core mean |     Δ core |     Peak RSS | Final DFA states | Default heap |
| ------------------------------- | ------------: | ---------: | -----------: | ---------------: | ------------ |
| Persistent cache control        |     103.888 s |          — |     6.546 GB |          163,215 | No           |
| Whole-cache clear every 500     |     126.450 s |     +21.7% |     4.640 GB |                0 | Yes          |
| Cold-only per-decision bound    |     126.900 s |     +22.2% |     4.681 GB |          137,201 | Yes          |
| Hot bound 50,000 states         |     124.400 s |     +19.7% |     4.071 GB |           78,465 | Yes          |
| **Selected 90,000/2,000 bound** | **116.333 s** | **+12.0%** | **4.816 GB** |       **65,484** | **Yes**      |

The selected policy lowers peak RSS by 26.4% and retained states by 59.9%
relative to the persistent-cache control. No file changed its parse tree, token
counts, diagnostics, prediction mode, or fallback attempts.

Raw candidate data is in [`screening.json`](screening.json); the per-decision
state distribution and growth checkpoints are in
[`state-distribution.json`](state-distribution.json).

## State attribution

A persistent-cache pass ends with 163,215 states across 271 populated decisions.
The distribution is extremely concentrated:

| Rank | Decision | Rule                    | States | Share | Cumulative |
| ---: | -------: | ----------------------- | -----: | ----: | ---------: |
|    1 |     2993 | `general_element_part`  | 105346 | 64.5% |      64.5% |
|    2 |     2251 | `statement`             |  12655 |  7.8% |      72.3% |
|    3 |     2990 | `general_element`       |   8973 |  5.5% |      77.8% |
|    4 |     2595 | `unary_expression_core` |   8060 |  4.9% |      82.7% |
|    5 |     2288 | `body`                  |   7178 |  4.4% |      87.1% |
|    6 |     2266 | `cursor_loop_param`     |   3584 |  2.2% |      89.3% |
|    7 |     2622 | `atom`                  |   2434 |  1.5% |      90.8% |
|    8 |     2217 | `seq_of_declare_specs`  |   1984 |  1.2% |      92.0% |

Decision 2993 alone holds 64.5% of the cache and grows from 69,055 states at
file 1,200 to 105,346 at the end of the pass. Any bound that ignores it cannot
control memory; any bound that clears every decision discards the expensive
tail.

The hot set comes from the optimized TypeScript profile in experiment 014.
Decisions 2993, 2251, 2990, and 2595 dominate prediction time and have 0.95–0.97
SLL DFA hit rates. Decisions 2288, 2266, 2622, and 2217 are large but
lower-value: they are the cold set that the bound may rebuild.

## Policy

The selected policy is enforced every 10 completed files:

- hot decisions `2993,2251,2990,2595` are bounded at 90,000 states each;
- every other decision is bounded at 2,000 states;
- no decision is exempt from the aggregate bound when
  `LAB_DFA_TOTAL_MAX_STATES` is set.

At an enforcement pass, a decision that exceeds its bound is replaced with a
fresh `DFA` for the same ATN decision state. The generated parser shares one
`decisionToDFA` array across parser instances, so later parsers see the evicted
cache. The generated grammar and the consumer API are untouched.

A full pass performs 124 enforcement passes, most of which are no-ops, and only
eight decision resets:

| Decision | Resets | Rule                   |
| -------: | -----: | ---------------------- |
|     2288 |      4 | `body`                 |
|     2266 |      2 | `cursor_loop_param`    |
|     2622 |      1 | `atom`                 |
|     2993 |      1 | `general_element_part` |

The 90,000-state bound is crossed once, before the most expensive tail files, so
the dominant decision is rebuilt at a point where the remaining work is still
amortizable. A 50,000-state bound crosses repeatedly and costs 19.7%; a
100,000-state bound is never reached and therefore does not bound the cache.

## Conformance

Control and candidate passes were compared on every file for structural parse
tree digest, lexer diagnostics, parser diagnostics, visible and hidden token
counts, prediction mode, and SLL/LL attempt counts.

| Files compared | Differences | Accepted | Diagnostics | Fallback files |
| -------------: | ----------: | -------: | ----------: | -------------: |
|          1,244 |           0 |    1,235 |         107 |             15 |

## Rejected candidates

| Candidate                           |      Core | Peak RSS | Outcome                                                            |
| ----------------------------------- | --------: | -------: | ------------------------------------------------------------------ |
| Cold bound only                     |   126.9 s | 4.681 GB | +22.2%; leaves decision 2993 unbounded                             |
| Hot bound 50,000                    |   124.4 s | 4.071 GB | +19.7%; repeated relearning of decision 2993                       |
| Hot bound 100,000                   |   110.5 s | 4.795 GB | Bound never reached; cache is not bounded                          |
| Heap-triggered at 2,000 MiB         | 110–174 s | 4.701 GB | No deterministic enforcement point; one run recorded a 1,046 s gap |
| Cold bound at 4,000 states every 10 |   116.0 s | 4.826 GB | Viable, but retains more states than the selected cold bound       |
| Hot bound 70,000 every 20 files     |   117.2 s | 4.585 GB | Viable, but slower and retains more states                         |

The heap-triggered family is specifically rejected: its enforcement point
depends on garbage-collection timing, and repeated runs produced retained-state
counts from 73,847 to 75,446 and core times from 110.3 s to 174.0 s. The
interval policy is deterministic and produced 65,484 states in every repeat.

## Host-load control

Absolute timings shifted with host load during the experiment. A second session
measured a fresh persistent-cache control and the selected policy back to back
without tree hashing:

| Session             |   Control |  Selected | Relative |
| ------------------- | --------: | --------: | -------: |
| Rebaseline          | 103.888 s | 116.333 s |   +12.0% |
| Paired, higher load | 132.260 s | 147.954 s |   +11.9% |

The relative overhead is stable; the relative memory reduction is larger than
the difference between sessions.

## Threats to validity

- Peak RSS is a process high-water mark. Final heap samples were approximately
  2.5 GB for the candidate and 4.5 GB for the control, but neither is a
  post-GC retained-memory measurement.
- State counts are not byte-accurate: one state's configuration set can be
  larger than another's. They are a deterministic proxy, not an allocation
  profile.
- The 90,000-state hot bound is empirical. The rules are corpus-independent, but
  a different grammar or workload could move the optimal bound.
- The selected policy was measured in three fresh-process passes; rejected
  candidates were screened once unless noted. Their regressions are large enough
  that finer resolution would not change the decision.
- Structural identity bounds parser input only; external declaration and
  reference qualification remains required.

## Decision

Retain selective eviction as an opt-in memory bound. The production default
remains the persistent cache because the selected policy still costs 12% core
latency. Memory-constrained deployments can set the six `LAB_DFA_*` selective
variables and finish under Node's default heap without the 22–38% regression of
whole-cache clearing.
