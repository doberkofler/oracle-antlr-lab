# Conclusion

**Status:** accepted; default TypeScript generated parser updated.

Decision 2993 in `general_element_part` was the largest remaining predictor.
It ran once for every `LEFT_PAREN` after an element and consumed 49.0% of the
instrumented tail prediction time. A complete corpus census showed 55,402 calls,
154 exits, and only two exit shapes: Oracle's `(+)` outer-join marker (152) and
`TREAT` (2). Every other call continued into a function-argument list.

The accepted transform continues directly for ordinary parentheses, exits for
`(+)`, keeps adaptive prediction for `TREAT`, and restores prediction after a
syntax error. It is applied as generated-parser post-processing after the
existing `LEFT_PAREN` loop guard. The grammar, ATN state assignment, parse tree
shape, and visitor surface are unchanged.

## Performance

| Scope                                      |   Control | Candidate |        Change |
| ------------------------------------------ | --------: | --------: | ------------: |
| Full 1,244-file core, same session         | 108.019 s |  71.717 s | −33.6%, 1.51× |
| Official-grammar baseline (experiment 011) | 103.888 s |  71.717 s |        −31.0% |
| Pre-issue-#1 baseline                      | 156.093 s |  71.717 s | −54.1%, 2.18× |
| Peak RSS mean                              |  6.423 GB |  5.355 GB |        −16.6% |

Candidate core CV was 0.56% over three fresh-process passes. Java was unchanged
at 49.942 s control versus 49.954 s candidate.

## Conformance

- Issue-18 gate: 1,244 of 1,244 files identical, zero intended, unsupported, or
  defect classifications.
- Combined gate: 1,135 identical and 109 previously intended fallback-removal
  transitions, with zero defects.
- Fallback files and diagnostics remain 15 and 107.

## Public fixtures

The generated public corpus adds valid outer-join/unary-argument and `TREAT`
sources plus a recovery fixture that places a valid function call after an
invalid statement.

## Limits

The `TREAT` path still uses context-sensitive prediction because its
parenthesized syntax is not a function-argument list. The post-error path also
retains prediction. Removing either conservative guard would require a separate
census and conformance result.

The transform is TypeScript-specific generated-parser post-processing. No
grammar change was made, so nothing is proposed upstream. Java remains the
unchanged grammar control and is not requalified as a replacement.

## Follow-up

The remaining prediction hotspots are decisions 2990 and 2989 in
`general_element` and decision 2595 in `unary_expression_core`. The same method
applies: census the alternatives first, then replace prediction only where the
consuming alternative is provably impossible or a bounded lookahead is
observationally complete and semantically gated.
