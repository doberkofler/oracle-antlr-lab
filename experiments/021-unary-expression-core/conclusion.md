# Conclusion

**Status:** accepted; generated-parser transform enabled by default.

Decision 2595 in `unary_expression_core` now resolves from its first tokens
instead of running adaptive prediction for every expression operand. On the
complete production corpus the TypeScript parser core fell from 68.140 s to
62.913 s (−7.7%, paired −4.201 ms per file), peak RSS fell 6.1%, and every
structural, token, acceptance, and diagnostic observation stayed identical.

The gain is larger than the tail profile alone suggests because the transform
also removes the DFA state growth that decision 2595 accumulated across a
cache-reuse pass. That growth contributes to both latency and peak RSS.

## How it works

Four alternatives have a unique first token and are selected directly.
`standard_function` and `atom` overlap only when a name is followed by an
argument list or a cursor attribute:

- argument list after a numeric aggregate: `atom`'s predicate rejects it, so the
  numeric function is the only alternative;
- argument list after a dedicated function keyword: prediction is retained;
- argument list after a generic name: `standard_function` can only match through
  a depth-one `USING` modeling clause, which is detected by a bounded scan;
- everything else starting like `atom`: `atom` is selected.

The dedicated-keyword set is derived from the generated ATN at first use rather
than hard-coded, so the pinned grammar remains the source of truth.

`CASE` is deliberately left on adaptive prediction. It is a non-reserved
keyword, and malformed `CASE` input can fall back to `atom`; forcing
`case_expression` changed recovery on one corpus file during development. The
other fast paths select an alternative that is the only one able to match the
next two tokens, so they remain identical before and after a syntax error.

## Validation

- Issue-19 gate: 1,244/1,244 identical, zero defects.
- Combined gate: 1,135 identical / 109 intended, zero defects.
- Fallback files and diagnostics unchanged at 15 and 107.
- Decision-2595 adaptive-prediction calls fell 97.1% on the tail profile; the
  remaining calls are the deliberately conservative cases.
- Public fixture and unit tests cover every alternative, malformed expressions,
  and signed and nested operands.
- `pnpm verify` passes.

## Limits

The benchmark heap and cache policy are unchanged and recorded with the
reports. Java remains an unmodified control and outside this result. The
corpus is the frozen production sample plus the public synthetic corpus; Oracle
acceptance and downstream qualification remain external.
