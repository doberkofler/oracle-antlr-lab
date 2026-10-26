# Problem Register

Inputs for this register come from the retained CodeIndex Oracle ANTLR decision
record and the pinned grammar. They are public facts and upstream links; no
private source or qualification rows are reproduced here.

## 1. The parser is slow for a measurable reason

Historical full-corpus evidence:

| Metric                                  | Structural baseline |     ANTLR candidate |  Ratio |
| --------------------------------------- | ------------------: | ------------------: | -----: |
| Cold-build wall time                    |            9,109 ms |      148,041.474 ms | 16.25× |
| Structural compiler versus ANTLR parser |            2,893 ms |      147,133.566 ms | 50.86× |
| ANTLR single-worker peak RSS            |                   — | 5,018,288,128 bytes |      — |

The documented profiling result attributes the tail to adaptive prediction in
core name and expression rules, not to semantic collection. Warm runs with and
without parse-tree construction differed by about 1%.

Hypotheses to test here:

- `general_element_part`, `routine_name`, and `general_element` dominate
  prediction time on large files.
- The SLL probe followed by LL is material, but not the only cause.
- Segment-first parsing reduces worst-case contexts but may regress small files.
- Parser/ATN construction is a large share of fresh-process cold cost.

## 2. Quality evidence is historical and contract-bound

| Evidence                                                     |        Declarations |          References |    Dependencies |
| ------------------------------------------------------------ | ------------------: | ------------------: | --------------: |
| Current `structural@5`, contract `oracle-o1@4` / policy `v5` |     99.9489% / 100% |     99.6697% / 100% |     100% / 100% |
| Historical `structural@1`, policy `v2`                       | 95.5394% / 99.9711% | 57.4956% / 99.3464% | 98.1734% / 100% |
| Historical `antlr@1`, policy `v2`                            | 96.9403% / 99.9659% | 69.1314% / 99.3900% | 97.9784% / 100% |

The ANTLR row is comparative decision provenance, not a current contract result.
The current parser identity is `antlr@2`, and no current `oracle-o1@4` / `v5`
report is committed.

Parser correctness is not measured by this repository. A speed result cannot
establish semantic acceptance. Any promising grammar or runtime change must be
returned to the external qualification suite.

## 3. Known parser and lexer risks

| Risk                                                   | Effect                                                                                                              | Owner                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `REMARK_COMMENT` accepts ASCII space, not tab          | `REM<TAB>` lines become visible tokens; declaration-shaped comments can create phantom facts in a semantic consumer | Pinned grammar; upstream `grammars-v4#5124`           |
| Non-literal `$IF` keeps both branches                  | Duplicate declarations when both branches declare the same name                                                     | Adapter policy, not grammar                           |
| Dependency slicing is syntactic                        | `pkg.coll.exists` can be read as `schema.package` and preserved as an external package call                         | Adapter policy, not grammar                           |
| Structural scanner does not materialize loop iterators | Iterator declarations differ from a full parse                                                                      | Production adapter                                    |
| `%TYPE`/`%ROWTYPE` handling differs by consumer        | Current structural and full parsers both emit type references; old comparisons are stale                            | Retired statement; do not re-open without a new probe |

## 4. Open grammar gaps

| Construct                                                                       | Upstream request         | Laboratory status                                                                        |
| ------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| SQL*Plus `REM<TAB>`                                                             | `antlr/grammars-v4#5124` | Reproducer in the pinned grammar; production-relevant                                    |
| `XMLTABLE ... RETURNING SEQUENCE BY REF`                                        | `antlr/grammars-v4#5125` | Valid documented order; upstream reproducer is valid                                     |
| SQL*Plus `EXEC[UTE]`                                                            | `antlr/grammars-v4#5126` | Qualification-only for this adapter                                                      |
| Keywords as identifiers (`DATE`, `DETECTED`, `ENCLOSED`)                        | `antlr/grammars-v4#720`  | Current-master comment posted                                                            |
| Constant-sized type parameters, `IS JSON(STRICT)`, `DATE NULL`, record `INSERT` | None yet                 | Source origins known; Oracle 19c compile proof still required before upstream submission |

Reduced fixtures can change validity. Correct a fixture before using it as
upstream evidence; see the external decision record for the XMLTABLE correction.

## 5. Baseline finding

The first public baseline
([`experiments/001-public-baseline`](../experiments/001-public-baseline/conclusion.md))
measured a 63.4 ms TypeScript cold parser core and a 71.4 ms Java cold parser
core on 48 synthetic files. A fresh JVM added about 1,444 ms of construction and
startup, while a fresh Node.js process added about 0.2 ms. The TypeScript pass
completed the 48-file sample in 378.8 ms total; the Java pass took 245.6 ms in
one JVM.

This supports two separate optimization questions: reduce first-use JVM
construction, and reduce steady parser work. They are not the same bottleneck.

## 6. What this repository should answer first

1. Is the historical full-corpus cost reproducible on the pinned grammar?
2. What share is parser/ATN construction versus prediction?
3. How much does SLL fallback cost by file size?
4. Does segment-first parsing improve the large-file tail without regressing small
   files?
5. Do grammar fixes reduce recovery cost without increasing ambiguity?
6. Does an official Java target or another runtime change the constant factor?

## 7. Production-scale finding

Experiments
[`003-production-scale`](../experiments/003-production-scale/conclusion.md) and
[`004-bottleneck-profile`](../experiments/004-bottleneck-profile/conclusion.md)
answer the first three performance questions on the frozen 1,244-file corpus.

- TypeScript parser core averaged 156.093 s and peaked at 4.710 GB RSS. This is
  within 6.1% of the historical 147.134 s / 5.018 GB result, so that result is
  reproduced rather than rejected.
- Parser core alone is 17.36× the retained structural full-rebuild build stage
  and 10.57× the retained structural cold-build stage. These conservative
  comparisons are broader than a phase-identical parser comparison.
- The largest byte-size quartile consumes 84.1% of TypeScript parser core.
- Setup is 0.07% and lexing is 0.44% of parser core. SLL consumes 54.47%; LL
  fallback consumes 45.09% despite occurring in only 10.4% of files.
- On the 12 highest-cost files, `general_element_part`, `routine_name`, and
  `general_element` consume 63.0% of Java profiling elapsed time. The latter two
  rules account for 12,727 recorded ambiguities.

Java parser core averaged 40.106 s, but its unmodified grammar retained 486
diagnostics. This is a constant-factor result, not semantic acceptance evidence.

Experiment
[`005-general-element-part-optimization`](../experiments/005-general-element-part-optimization/conclusion.md)
guards the hot `general_element_part` argument-loop prediction with its
`LEFT_PAREN` FIRST token. TypeScript parser core fell 10.48% on the complete
corpus and 14.40% on the 12-file tail, with no per-file token, diagnostic,
prediction-mode, or fallback-attempt differences across three repetitions.

Experiment
[`006-routine-name-and-general-element`](../experiments/006-routine-name-and-general-element/conclusion.md)
resolves the clean-input `routine_name` dotted-name loop with two-token lookahead
and gates both `general_element` dotted-part predictions with the `PERIOD` FIRST
token. The candidate retains adaptive prediction after a syntax error and when a
period can belong to the caller. TypeScript parser core fell a further 10.97% on
the complete corpus and 19.73% on the 12-file tail. All 1,244 parse-tree digests,
diagnostics, token counts, prediction modes, and fallback attempts matched the
post-#1 control.

Experiment
[`007-full-file-ll-fallback`](../experiments/007-full-file-ll-fallback/conclusion.md)
classifies the remaining full-file LL fallback. Collection-method access
(`DELETE`, `EXTEND`, `TRIM`) and `BULK COLLECT INTO` account for 109 of the 129
fallback files; both are SLL-vs-LL conflicts, not grammar gaps. Full-context
prediction at the collection-method decisions plus a `BULK COLLECT` alias guard
reduced fallback files to 20 and TypeScript parser core by 24.64% on the
complete corpus and 24.45% on the tail. Parse-tree digests, diagnostics, and
token counts remained identical for all files. The remaining 20 files split into
14 genuine grammar gaps that also fail under LL and 6 other SLL-only conflicts.

## 8. Out of scope

- Semantic symbol, reference, and dependency extraction.
- PL/Scope normalization and release gates.
- Production corpus publication.
- Claims that a parser-speed change alone justifies adoption.
