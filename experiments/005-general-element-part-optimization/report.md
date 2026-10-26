# 005-general-element-part-optimization

Corpus: private-production-20261027, 1244 opaque files. Three fresh-process cache-reuse passes unless config states otherwise.

| Adapter    |     Wall mean ms [bootstrap 95% CI] | Wall CV | Core mean ms | Peak RSS max | LL fallback files | Diagnostics max |
| ---------- | ----------------------------------: | ------: | -----------: | -----------: | ----------------: | --------------: |
| typescript | 141240.884 [139204.822, 142307.168] |   1.25% |   139735.917 |    4679.6 MB |               129 |             181 |
| java       |    41405.312 [41177.936, 41649.963] |   0.57% |    39176.462 |    4425.4 MB |               150 |             486 |

| Adapter    | Size stratum | Files |       Byte range | Core mean ms |      Bootstrap 95% CI | LL fallback files |
| ---------- | ------------ | ----: | ---------------: | -----------: | --------------------: | ----------------: |
| typescript | Q1 smallest  |   311 |     115 B–2.1 kB |     1725.521 |     1715.851–1735.890 |                 0 |
| typescript | Q2           |   311 |    2.1 kB–5.2 kB |     3362.287 |     3351.058–3382.562 |                 6 |
| typescript | Q3           |   311 |   5.2 kB–16.8 kB |    18356.201 |   18282.073–18485.639 |                29 |
| typescript | Q4 largest   |   311 | 17.0 kB–370.0 kB |   116291.908 | 115093.791–116931.258 |                94 |
| java       | Q1 smallest  |   311 |     115 B–2.1 kB |      736.855 |       734.608–739.042 |                 1 |
| java       | Q2           |   311 |    2.1 kB–5.2 kB |     1180.996 |     1176.584–1184.263 |                 6 |
| java       | Q3           |   311 |   5.2 kB–16.8 kB |     5928.326 |     5855.183–5981.609 |                33 |
| java       | Q4 largest   |   311 | 17.0 kB–370.0 kB |    31330.285 |   30959.952–31754.977 |               110 |

Wall time includes child process/container startup and source loading. Core time is lexer plus SLL and LL parsing. Peak RSS is the process high-water mark.
