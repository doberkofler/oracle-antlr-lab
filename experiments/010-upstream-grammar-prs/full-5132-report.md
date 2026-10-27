# 010-upstream-grammar-prs-full-5132

Selection: full; All 1244 files in private-production-20261027..
Fingerprint: `dc595c376242f2245d5451384945cd8686334ccc5bdcb66b8349a788c2c06d7c`; 1244 files.

Repetitions per state: 3; one fresh Node.js process per repetition.

| State   | Pull request | Parser core p50 (ms) |      95% CI (ms) |     CV | Wall p50 (ms) | Fallback files | Peak RSS |
| ------- | -----------: | -------------------: | ---------------: | -----: | ------------: | -------------: | -------: |
| control |            — |              91977.9 | 91849.0–188636.7 | 44.98% |         92981 |             19 |  6.42 GB |
| pr-5132 |        #5132 |             159916.7 | 98312.3–162108.1 | 25.85% |        161133 |             18 |  6.28 GB |

## Paired comparison

| Candidate | Control p50 (ms) | Candidate p50 (ms) | Paired delta mean (relative) |      95% CI (ms) | Claim     |
| --------- | ---------------: | -----------------: | ---------------------------: | ---------------: | --------- |
| pr-5132   |          91977.9 |           159916.7 |             15957.8 (12.85%) | -90324.4–70259.1 | no-change |

A change is claimed only when every repetition moves in the same direction, the paired mean differs from zero at a 95% confidence level, and the difference is at least 1% of the control parser core.
