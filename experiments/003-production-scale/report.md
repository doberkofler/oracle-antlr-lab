# 003-production-scale

Corpus: private-production-20261027, 1244 opaque files. Three fresh-process cache-reuse passes unless config states otherwise.

| Adapter    |     Wall mean ms [bootstrap 95% CI] | Wall CV | Core mean ms | Peak RSS max | LL fallback files | Diagnostics max |
| ---------- | ----------------------------------: | ------: | -----------: | -----------: | ----------------: | --------------: |
| typescript | 157455.951 [146854.809, 175355.338] |   9.90% |   156093.404 |    4710.4 MB |               129 |             181 |
| java       |    42142.719 [41891.607, 42521.432] |   0.79% |    40106.398 |    4417.6 MB |               150 |             486 |

| Adapter    | Size stratum | Files |       Byte range | Core mean ms |      Bootstrap 95% CI | LL fallback files |
| ---------- | ------------ | ----: | ---------------: | -----------: | --------------------: | ----------------: |
| typescript | Q1 smallest  |   311 |     115 B–2.1 kB |     1897.075 |     1792.433–2025.054 |                 0 |
| typescript | Q2           |   311 |    2.1 kB–5.2 kB |     3542.801 |     3455.212–3707.329 |                 6 |
| typescript | Q3           |   311 |   5.2 kB–16.8 kB |    19449.006 |   19177.742–19893.126 |                29 |
| typescript | Q4 largest   |   311 | 17.0 kB–370.0 kB |   131204.523 | 121673.664–149636.385 |                94 |
| java       | Q1 smallest  |   311 |     115 B–2.1 kB |      750.941 |       730.927–790.665 |                 1 |
| java       | Q2           |   311 |    2.1 kB–5.2 kB |     1208.382 |     1200.059–1222.949 |                 6 |
| java       | Q3           |   311 |   5.2 kB–16.8 kB |     5992.678 |     5949.413–6030.728 |                33 |
| java       | Q4 largest   |   311 | 17.0 kB–370.0 kB |    32154.396 |   31983.976–32431.784 |               110 |

Wall time includes child process/container startup and source loading. Core time is lexer plus SLL and LL parsing. Peak RSS is the process high-water mark.
