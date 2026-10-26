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

## 7. Out of scope

- Semantic symbol, reference, and dependency extraction.
- PL/Scope normalization and release gates.
- Production corpus publication.
- Claims that a parser-speed change alone justifies adoption.
