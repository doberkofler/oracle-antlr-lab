# Java token divergence

The 51 files that failed experiment 013 all diverge at the same lexical boundary.

## Symbolic token diagnosis

| Java input                 | Identical files | Different files | First divergence at a `DOLLAR_*` token |
| -------------------------- | --------------: | --------------: | -------------------------------------: |
| Raw source                 |           1,193 |              51 |                                     51 |
| Production-prepared source |           1,244 |               0 |                                      0 |

In every differing file the first Java-only token is `DOLLAR_IF`. The TypeScript side has already hidden the disabled conditional-compilation range, so its first divergent position falls on the next comment, whitespace, or visible token. Per-file indices and symbolic names are retained in the private `diagnosis.json`; no token text or source offsets are recorded.

There are 52 production files containing `$if`; one does not produce a token-stream difference, so the observed 51 is the set where preprocessing changes the emitted stream.

## Public reduced fixture

`corpora/public/files/edge_conditional.pkb` is a 216-byte fixture with a disabled then-branch and an enabled else-branch. Raw-input cross-runtime conformance fails it; prepared-input conformance passes it. Three smaller fixtures under `corpora/fixtures/cross-runtime/` cover disabled, enabled, and nested directives.

| Corpus           | Java input | Identical | Different |
| ---------------- | ---------- | --------: | --------: |
| Public, 48 files | Raw        |        47 |         1 |
| Public, 48 files | Prepared   |        48 |         0 |

## Complete structural requalification

With identical prepared input, the full production gate passes:

| Runtime    | Accepted files | Diagnostics | LL fallback files |
| ---------- | -------------: | ----------: | ----------------: |
| TypeScript |          1,235 |         107 |                15 |
| Java       |          1,235 |         107 |               124 |

All 1,244 structural parse-tree digests, visible and hidden token counts, and diagnostic counts match. The LL fallback strategy still differs: Java reparses more files but converges to the same trees and diagnostics.

## Threats to validity

- Conditional preprocessing is implemented once in TypeScript and mirrored into a temporary Java input mount. The Java adapter is not standalone for conditional compilation.
- Parse-tree identity is structural; token text and source offsets are intentionally excluded.
- The Java benchmark path was not changed, so the measured 45.234 s parser core is not corrected by this experiment.
- Diagnostic counts match, but diagnostic text and positions are not compared across runtimes.
