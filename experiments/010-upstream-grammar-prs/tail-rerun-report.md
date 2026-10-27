# 010-upstream-grammar-prs-tail-rerun

Selection: tail; 12 highest medianCoreMs files from experiments/004-bottleneck-profile/report.json; tail-biased by design..
Fingerprint: `b32a43a1f03ae4c4f1ec8f282b19015d446e19e4f8c209223a1c62f3419f1444`; 12 files.

Repetitions per state: 5; one fresh Node.js process per repetition.

| State      | Pull request | Parser core p50 (ms) |     95% CI (ms) |     CV | Wall p50 (ms) | Fallback files | Peak RSS |
| ---------- | -----------: | -------------------: | --------------: | -----: | ------------: | -------------: | -------: |
| control    |            — |              33983.4 | 32775.0–84176.6 | 59.33% |         34750 |              1 |  3.19 GB |
| cumulative |            — |              34898.5 | 33784.8–59585.9 | 44.02% |         35818 |              1 |  3.21 GB |

## Paired comparison

| Candidate  | Control p50 (ms) | Candidate p50 (ms) | Paired delta mean (relative) |      95% CI (ms) | Claim     |
| ---------- | ---------------: | -----------------: | ---------------------------: | ---------------: | --------- |
| cumulative |          33983.4 |            34898.5 |           -12807.7 (-23.07%) | -50682.6–19714.6 | no-change |

A change is claimed only when every repetition moves in the same direction, the paired mean differs from zero at a 95% confidence level, and the difference is at least 1% of the control parser core.
