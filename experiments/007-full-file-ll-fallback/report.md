# 007-full-file-ll-fallback

Corpus: private-production-20261027, 1244 opaque files. Three fresh-process cache-reuse passes unless config states otherwise.

| Adapter    |  Wall mean ms [bootstrap 95% CI] | Wall CV | Core mean ms | Peak RSS max | LL fallback files | Diagnostics max |
| ---------- | -------------------------------: | ------: | -----------: | -----------: | ----------------: | --------------: |
| typescript | 92982.086 [92592.512, 93473.154] |   0.48% |    92241.382 |    4672.8 MB |                20 |             181 |
| java       | 41397.426 [41007.668, 41718.584] |   0.87% |    39250.917 |    4427.4 MB |               150 |             486 |

| Adapter    | Size stratum | Files |       Byte range | Core mean ms |    Bootstrap 95% CI | LL fallback files |
| ---------- | ------------ | ----: | ---------------: | -----------: | ------------------: | ----------------: |
| typescript | Q1 smallest  |   311 |     115 B–2.1 kB |     1764.592 |   1749.120–1773.225 |                 0 |
| typescript | Q2           |   311 |    2.1 kB–5.2 kB |     3308.511 |   3277.321–3334.163 |                 1 |
| typescript | Q3           |   311 |   5.2 kB–16.8 kB |    16573.469 | 16431.389–16678.580 |                 6 |
| typescript | Q4 largest   |   311 | 17.0 kB–370.0 kB |    70594.810 | 70075.478–71294.942 |                13 |
| java       | Q1 smallest  |   311 |     115 B–2.1 kB |      742.537 |     736.508–753.508 |                 1 |
| java       | Q2           |   311 |    2.1 kB–5.2 kB |     1206.120 |   1194.836–1221.991 |                 6 |
| java       | Q3           |   311 |   5.2 kB–16.8 kB |     5970.637 |   5926.021–6024.101 |                33 |
| java       | Q4 largest   |   311 | 17.0 kB–370.0 kB |    31331.624 | 30980.376–31613.729 |               110 |

Wall time includes child process/container startup and source loading. Core time is lexer plus SLL and LL parsing. Peak RSS is the process high-water mark.
