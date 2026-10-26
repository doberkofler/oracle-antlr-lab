# 006-routine-name-and-general-element

Corpus: private-production-20261027, 1244 opaque files. Three fresh-process cache-reuse passes unless config states otherwise.

| Adapter    |     Wall mean ms [bootstrap 95% CI] | Wall CV | Core mean ms | Peak RSS max | LL fallback files | Diagnostics max |
| ---------- | ----------------------------------: | ------: | -----------: | -----------: | ----------------: | --------------: |
| typescript | 125148.380 [123569.377, 127154.888] |   1.46% |   124403.230 |    4697.6 MB |               129 |             181 |
| java       |    42155.727 [42007.702, 42352.486] |   0.42% |    40116.403 |    4426.8 MB |               150 |             486 |

| Adapter    | Size stratum | Files |       Byte range | Core mean ms |     Bootstrap 95% CI | LL fallback files |
| ---------- | ------------ | ----: | ---------------: | -----------: | -------------------: | ----------------: |
| typescript | Q1 smallest  |   311 |     115 B–2.1 kB |     1804.610 |    1750.866–1901.139 |                 0 |
| typescript | Q2           |   311 |    2.1 kB–5.2 kB |     3716.612 |    3376.194–4386.260 |                 6 |
| typescript | Q3           |   311 |   5.2 kB–16.8 kB |    18385.281 |  17803.296–19509.751 |                29 |
| typescript | Q4 largest   |   311 | 17.0 kB–370.0 kB |   100496.727 | 99893.313–100992.631 |                94 |
| java       | Q1 smallest  |   311 |     115 B–2.1 kB |      743.409 |      731.169–757.961 |                 1 |
| java       | Q2           |   311 |    2.1 kB–5.2 kB |     1202.998 |    1196.141–1211.227 |                 6 |
| java       | Q3           |   311 |   5.2 kB–16.8 kB |     5991.741 |    5956.879–6023.060 |                33 |
| java       | Q4 largest   |   311 | 17.0 kB–370.0 kB |    32178.255 |  32051.465–32352.093 |               110 |

Wall time includes child process/container startup and source loading. Core time is lexer plus SLL and LL parsing. Peak RSS is the process high-water mark.

## Independent 12-file tail candidates

| State             | Core mean [bootstrap 95% CI] | Standard deviation |    CV |  Change |
| ----------------- | ---------------------------: | -----------------: | ----: | ------: |
| Control           |    49.190 s [48.821, 49.390] |            0.320 s | 0.65% |       — |
| `general_element` |    48.855 s [48.664, 48.988] |            0.169 s | 0.35% |  -0.68% |
| `routine_name`    |    40.784 s [40.511, 41.104] |            0.299 s | 0.73% | -17.09% |
| Combined          |    41.541 s [40.795, 42.693] |            1.012 s | 2.44% | -15.55% |

The `general_element` confidence interval overlaps control. See
[`independent-tail.json`](independent-tail.json) for aggregate samples and the
retained invalidated high-noise run.
