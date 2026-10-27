# 010-upstream-grammar-prs-tail

Selection: tail; 12 highest medianCoreMs files from experiments/004-bottleneck-profile/report.json; tail-biased by design..
Fingerprint: `b32a43a1f03ae4c4f1ec8f282b19015d446e19e4f8c209223a1c62f3419f1444`; 12 files.

Repetitions per state: 3; one fresh Node.js process per repetition.

| State      | Pull request | Parser core p50 (ms) |      95% CI (ms) |     CV | Wall p50 (ms) | Fallback files | Peak RSS |
| ---------- | -----------: | -------------------: | ---------------: | -----: | ------------: | -------------: | -------: |
| control    |            — |              30421.9 |  30281.2–30616.1 |  0.55% |         31105 |              1 |  3.16 GB |
| pr-5132    |        #5132 |              23503.6 |  23413.1–23874.9 |  1.04% |         24202 |              1 |  2.73 GB |
| cumulative |            — |              30391.3 | 28488.9–114022.7 | 84.75% |         31114 |              1 |  3.17 GB |

## Paired comparison

| Candidate  | Control p50 (ms) | Candidate p50 (ms) | Paired delta mean (relative) |     95% CI (ms) | Claim       |
| ---------- | ---------------: | -----------------: | ---------------------------: | --------------: | ----------- |
| pr-5132    |          30421.9 |            23503.6 |            -6842.6 (-22.48%) | -6918.3–-6741.2 | improvement |
| cumulative |          30421.9 |            30391.3 |             27194.5 (89.34%) | -1792.3–83600.7 | no-change   |

A change is claimed only when every repetition moves in the same direction, the paired mean differs from zero at a 95% confidence level, and the difference is at least 1% of the control parser core.
