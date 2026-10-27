# 010-upstream-grammar-prs-full

Selection: full; All 1244 files in private-production-20261027..
Fingerprint: `dc595c376242f2245d5451384945cd8686334ccc5bdcb66b8349a788c2c06d7c`; 1244 files.

Repetitions per state: 3; one fresh Node.js process per repetition.

| State      | Pull request | Parser core p50 (ms) |       95% CI (ms) |    CV | Wall p50 (ms) | Fallback files | Peak RSS |
| ---------- | -----------: | -------------------: | ----------------: | ----: | ------------: | -------------: | -------: |
| control    |            — |             131602.4 | 130790.9–133795.9 | 1.18% |        132827 |             19 |  5.72 GB |
| cumulative |            — |             131977.8 | 131860.7–135998.1 | 1.77% |        133514 |             14 |  6.77 GB |

## Paired comparison

| Candidate  | Control p50 (ms) | Candidate p50 (ms) | Paired delta mean (relative) |    95% CI (ms) | Claim     |
| ---------- | ---------------: | -----------------: | ---------------------------: | -------------: | --------- |
| cumulative |         131602.4 |           131977.8 |               1215.8 (0.92%) | -1935.2–5207.2 | no-change |

A change is claimed only when every repetition moves in the same direction, the paired mean differs from zero at a 95% confidence level, and the difference is at least 1% of the control parser core.
