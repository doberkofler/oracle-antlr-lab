# Conclusion

**Status:** accepted.

Decision 2985, the `function_argument*` loop in `general_element_part`, accounted
for 4.382 s, 156,562 invocations, 1,500,663 SLL DFA transitions, 10,534 LL ATN
transitions, and 5,268 LL fallbacks in the instrumented 12-file baseline. Most
invocations only proved that a token other than `LEFT_PAREN` exits the loop.

The accepted generator post-processing guard skips adaptive prediction only
when `function_argument` cannot start. When lookahead is `LEFT_PAREN`, the
original context-sensitive prediction still decides whether the loop consumes
or exits. The generated call retains ANTLR's original ATN state assignment, so
`function_argument` contexts and visitor behavior are unchanged.

## Performance

| Scope                  | Baseline core mean [bootstrap 95% CI] | Candidate core mean [bootstrap 95% CI] |  Change | Candidate CV |
| ---------------------- | ------------------------------------: | -------------------------------------: | ------: | -----------: |
| 12-file tail           |             43.938 s [39.272, 53.224] |              37.613 s [36.968, 38.219] | -14.40% |        1.66% |
| Full 1,244-file corpus |          156.093 s [146.110, 174.241] |           139.736 s [138.471, 140.425] | -10.48% |        0.79% |

Full-corpus wall time fell from 157.456 s to 141.241 s. Peak TypeScript RSS was
effectively unchanged: 4.710 GB baseline versus 4.680 GB candidate.

## Conformance

All three full-corpus repetitions had zero per-file differences in lexer
diagnostics, parser diagnostics, visible tokens, hidden tokens, prediction mode,
SLL attempts, or LL attempts. Both states retained 129 fallback files and 181
diagnostics. Focused tests cover zero, one, and two adjacent argument groups.

The independent per-change gate is retained in
[`009-semantic-conformance`](../009-semantic-conformance/conclusion.md).

## Rejected candidates

- An entry semantic predicate preserved fallback behavior but increased profiled
  prediction time by 12.6%.
- An exit semantic predicate removed local fallback but increased prediction
  time and introduced diagnostics in two tail files.
- Inlining `function_argument` changed tree shape and left prediction cost and
  fallback unchanged.
- Unconditional `LEFT_PAREN` dispatch reduced full-corpus core time by 37.9%
  but introduced diagnostics in 25 previously clean files.

The accepted change keeps grammar language and parse structure intact while
removing predictions whose consuming alternative is impossible.
