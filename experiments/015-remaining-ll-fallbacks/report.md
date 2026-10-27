# Remaining full-file LL fallbacks

The optimized official grammar consistently falls back on 15 of 1,244 files:

| Classification                     | Files |
| ---------------------------------- | ----: |
| LL accepts with zero diagnostics   |     6 |
| LL retains one or more diagnostics |     9 |

Across three passes, fallback files consume a mean 6.900 s in the failed SLL attempt and 4.296 s in the final LL pass. Their complete parser core is 11.219 s. The final LL pass is 4.1% of the 103.888 s full-corpus core baseline.

The nine rejected files still require the LL recovery tree to preserve existing diagnostics and consumer input. The six accepted files demonstrate genuine context sensitivity; globally skipping LL would reject valid input. No file-identity or corpus-order special case is eligible for production.

## Threats to validity

- Diagnostic presence classifies outcomes, not root causes; private source and diagnostic text are intentionally excluded.
- 4.296 s is a theoretical upper bound on eliminating final LL work, not an achievable speedup.
- A localized grammar decision may still remove individual fallback cases, but requires separate reduced fixtures and conformance gates.
