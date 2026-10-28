# Conclusion

**Status:** accepted; two generated-parser transforms enabled by default.

Every valid full-file LL fallback in the production corpus now has a local
decision. Fallback files fell from 15 to 9, TypeScript parser core fell from
61.524 s to 60.889 s (−1.03%, paired −0.510 ms per file), and diagnostics and
all structural observations remained identical.

The cumulative original baseline is now `156.093 s → 60.889 s` (−61.0%,
2.56×), saving 95.204 seconds per full-corpus pass. Against the official-grammar
baseline (`103.888 s`) it is −41.4%, or 1.71×.

## How it works

Two reserved words caused the six accepted fallbacks:

- `BEGIN` is listed in `regular_id`, so SLL could consume the body keyword as a
  declaration name. Every generated declaration-section decision now selects the
  non-consuming alternative when the next token is `BEGIN`.
- `isNotStartOfJoin` omitted `JOIN`, so a table alias could consume a bare
  `JOIN`. The `table_ref_aux` alias decision now selects the no-alias
  alternative when the next token is `JOIN`.

Both rules use only the next token and generated rule structure. No corpus
identity, source path, file order, or source text participates.

## Validation

- Issue-20 gate: 1,238 identical / 6 intended / 0 defects.
- Combined gate: 1,129 identical / 115 intended / 0 defects.
- Fallback files 15 → 9; diagnostics unchanged at 107.
- The six intended differences are exactly the accepted fallback files; their
  trees, tokens, units, and diagnostics are unchanged.
- Public issue-20 gate: 52 identical / 2 intended / 0 defects across the two new
  synthetic fixtures.
- `pnpm verify` passes.

## Limits

The nine rejected files still fall back to LL for their recovery tree and
diagnostics. Localizing that recovery needs its own tree-and-diagnostic gate and
is not part of this result. The gain is bounded by the six accepted files; the
earlier estimate for all 15 fallbacks is not an achieved speedup. Java remains
an unchanged control, and Oracle acceptance and downstream qualification remain
external.
