# Conclusion

**Status:** accepted.

Experiment 004 identified `routine_name` and `general_element` as the second and
third largest prediction consumers on the 12-file tail. Experiment 005 then
promoted the `general_element_part` guard, so this experiment uses its report as
the control.

Two generated-code changes were accepted:

- `routine_name`: on clean input, decision 2901 now resolves the dotted-name
  loop from `PERIOD` plus the generated `id_expression` FIRST set. If a syntax
  error has already occurred, the original adaptive prediction remains active so
  recovery behavior is unchanged.
- `general_element`: decisions 2981 and 2982 now skip prediction when the next
  token is not `PERIOD`. When it is `PERIOD`, the original context-sensitive
  prediction still decides whether the loop continues or the caller consumes
  the period.

The grammar, ANTLR runtime, Java target, generated parse-tree classes, and
visitor surface are unchanged.

## Performance

| Scope                  | Control core mean [bootstrap 95% CI] | Candidate core mean [bootstrap 95% CI] |  Change | Candidate CV |
| ---------------------- | -----------------------------------: | -------------------------------------: | ------: | -----------: |
| 12-file tail           |            37.613 s [36.968, 38.219] |              30.191 s [29.862, 30.779] | -19.73% |        1.69% |
| Full 1,244-file corpus |         139.736 s [138.471, 140.425] |           124.403 s [122.835, 126.401] | -10.97% |        1.46% |

Full-corpus wall time fell from 141.241 s to 125.148 s. Peak TypeScript RSS was
effectively unchanged: 4.680 GB control versus 4.698 GB candidate.

## Conformance

One complete-corpus control pass and one candidate pass were parsed with the
same conditional-compilation preparation and tree digest. All 1,244 files
matched exactly on parse-tree SHA-256, lexer diagnostics, parser diagnostics,
visible tokens, hidden tokens, prediction mode, SLL attempts, and LL attempts.

Both states reported 181 parser diagnostics and 129 fallback files. The
per-file digest evidence is retained in [`conformance.json`](conformance.json).
Three full-corpus measurement repetitions also had no per-file token,
diagnostic, prediction-mode, or fallback-attempt differences.

## Rejected candidates

- Direct `general_element` continuation on every `PERIOD` reduced tail core by
  about 20% but raised the 12-file tail from 13 to 70 parser diagnostics. LL
  prediction intentionally exits the loop for dotted collection operations such
  as `list.DELETE(...)` and `list.EXTEND`.
- Factoring `general_element` into a single non-left-recursive dotted-part loop
  reduced single-pass tail core from 49.084 s to 46.250 s but changed parse-tree
  nesting on every tail file.
- Removing the `routine_name` adaptive prediction without the
  `id_expression` FIRST-set guard changed error recovery for invalid input such
  as `name.DETECTED`.
- Keeping the direct `routine_name` loop after a syntax error changed diagnostics
  and the parse tree on `source-001150.pkb`; retaining adaptive prediction after
  the first error removed the difference.

## Threats to validity

The tail is deliberately not representative of the whole corpus. Parse-tree
identity is necessary but not sufficient for semantic acceptance; a promising
candidate still belongs in the external qualification suite. The generated-code
transforms depend on the pinned antlr-ng output shape and fail generation when
that shape changes.
