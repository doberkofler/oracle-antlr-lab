# 010-upstream-grammar-prs-q4

Selection: q4; Largest byte-size quartile: 311 of 1244 files, reproduced from experiments/003-production-scale/report.json..
Fingerprint: `276f71f68eb1770ea99f73c52b2e23a088ba184f0c8b8e70a361fa1e93082e3e`; 311 files.

Repetitions per state: 3; one fresh Node.js process per repetition.

| State      | Pull request | Parser core p50 (ms) |       95% CI (ms) |     CV | Wall p50 (ms) | Fallback files | Peak RSS |
| ---------- | -----------: | -------------------: | ----------------: | -----: | ------------: | -------------: | -------: |
| control    |            — |             121470.6 | 110623.5–138162.5 | 11.24% |        122723 |             13 |  6.17 GB |
| pr-5132    |        #5132 |             116362.6 | 114360.7–116519.6 |  1.04% |        117704 |             12 |  5.96 GB |
| cumulative |            — |             128431.3 | 125400.5–139669.7 |  5.73% |        129794 |              9 |  5.64 GB |

## Paired comparison

| Candidate  | Control p50 (ms) | Candidate p50 (ms) | Paired delta mean (relative) |      95% CI (ms) | Claim     |
| ---------- | ---------------: | -----------------: | ---------------------------: | ---------------: | --------- |
| pr-5132    |         121470.6 |           116362.6 |             -7671.3 (-6.22%) |  -23801.8–5896.1 | no-change |
| cumulative |         121470.6 |           128431.3 |               7748.2 (6.28%) | -12762.0–18199.0 | no-change |

A change is claimed only when every repetition moves in the same direction, the paired mean differs from zero at a 95% confidence level, and the difference is at least 1% of the control parser core.
