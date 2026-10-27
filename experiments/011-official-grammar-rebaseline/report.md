# Official grammar rebaseline

Corpus: `private-production-20261027`; 1,244 opaque files; 20.9 MB. Three fresh-process cache-reuse passes. Node was given an 8 GB old-space limit because the unchanged campaign exhausted the default approximately 4 GB limit at file 1,243.

| Adapter    | Wall mean | Wall CV | Core mean | Core CV | Peak RSS max | LL fallback files | Diagnostics |
| ---------- | --------: | ------: | --------: | ------: | -----------: | ----------------: | ----------: |
| TypeScript | 105.509 s |   1.50% | 103.888 s |   1.16% |     6.546 GB |                15 |         107 |
| Java       |  47.625 s |   2.94% |  45.234 s |   3.23% |     4.417 GB |               144 |         367 |

TypeScript core bootstrap 95% CI: 103.073–105.269 s. Java core bootstrap 95% CI: 44.039–46.865 s.

## Conformance

All four optimization gates passed over all 1,244 files. The first two gates were identical. Full-file fallback removal and the combined gate had 1,135 identical files and 109 intended fallback-only transitions, with zero unsupported files and zero defects. TypeScript diagnostics remained 107 and optimized fallback files remained 15.

## Threats to validity

- The old 92.241 s optimized result and this result were recorded on different dates and Node versions; the comparison identifies a rebaseline, not a grammar-only causal estimate.
- Peak RSS is a process high-water mark, not retained heap.
- Java diagnostics prevent adoption; speed alone is not semantic qualification.
- Parse-tree identity bounds consumer input but does not replace external declaration/reference qualification.
