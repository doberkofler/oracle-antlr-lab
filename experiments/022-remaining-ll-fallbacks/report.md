# Remaining valid LL fallbacks

Two local decisions remove every valid full-file LL fallback from the production
corpus. Fallback files fall from 15 to 9; the nine remaining files still require
LL for their recovery tree and diagnostics.

| State     | Core mean | Core CV | Δ core | Peak RSS mean | Peak RSS max | Fallback files | Diagnostics |
| --------- | --------: | ------: | -----: | ------------: | -----------: | -------------: | ----------: |
| Control   |  61.524 s |   0.23% |      — |      4.839 GB |     4.995 GB |             15 |         107 |
| Candidate |  60.889 s |   1.32% | −1.03% |      4.277 GB |     4.739 GB |              9 |         107 |

The paired per-file delta is **−0.510 ms [−1.014, −0.055]**, which excludes zero.
Against the official-grammar baseline in experiment 011 (`103.888 s`) the
candidate is **41.4% faster** and **1.71×**; against the pre-issue-#1 baseline
(`156.093 s`) it is **61.0% faster** and **2.56×**. The cumulative saving is
95.204 seconds per full-corpus pass.

All 1,244 files remain structurally identical. Diagnostics are unchanged at 107,
and the Java control is unchanged.

## Fallback classes

Experiment 015 split the 15 fallback files into six that LL accepts and nine
that LL uses for recovery. The six accepted files reduce to two local
conflicts:

| Class               | Files | Conflicting decision                         | Control symptom                        |
| ------------------- | ----: | -------------------------------------------- | -------------------------------------- |
| Declaration section |     5 | optional `seq_of_declare_specs` and its loop | `BEGIN` consumed as a declaration name |
| Bare `JOIN` alias   |     1 | `table_ref_aux` alias decision               | `JOIN` consumed as a table alias       |

### Declaration section

`regular_id` admits `BEGIN` through the non-reserved keyword list, so SLL can
enter a declaration section at the token that starts a nested or function body.
Five files declare local names before the first `BEGIN`; the first statement
after that `BEGIN` starts with an identifier, so the declaration alternative
remains viable long enough to fail later.

`BEGIN` is reserved in Oracle and cannot name a declaration. Every generated
decision whose only consuming alternative is `seq_of_declare_specs` therefore
selects the non-consuming alternative:

```ts
this.tokenStream.LA(1) === PlSqlParser.BEGIN ? 2 : this.interpreter.adaptivePredict(...)
```

The transform applies to all eleven optional declaration sections and the
`seq_of_declare_specs` repetition loop. It does not hard-code a file, path,
size, ordering, or source text.

### Bare `JOIN` alias

`isNotStartOfJoin` excludes `INNER`, `CROSS`, `NATURAL`, `PARTITION`, `FULL`,
`LEFT`, `RIGHT`, and `OUTER`, but not `JOIN`. A table reference without an alias
can therefore consume `JOIN` as `table_alias` in SLL and fail at the joined
table. `JOIN` is reserved, so the alias alternative cannot match:

```ts
switch (this.tokenStream.LA(1) === PlSqlParser.JOIN ? 2 : this.interpreter.adaptivePredict(...)) {
```

This changes decision 2390 only when the next token is `JOIN`.

Neither decision introduces a corpus identity or a file-order heuristic. Both
follow from the reserved-word status of the next token and are independent of
the surrounding file.

## Conformance

The issue-specific gate compared the seven prior transforms against the
candidate over all 1,244 files:

| Compared | Identical | Intended | Unsupported | Defect |
| -------: | --------: | -------: | ----------: | -----: |
|    1,244 |     1,238 |        6 |           0 |      0 |

The six intended differences are exactly the accepted fallback files: prediction
changes from `sll-fallback-ll` to `sll`, while parse trees, token counts,
accepted units, and diagnostics remain identical.

The combined gate compared the unoptimized parser against the full candidate
state:

| Compared | Identical | Intended | Unsupported | Defect |
| -------: | --------: | -------: | ----------: | -----: |
|    1,244 |     1,129 |      115 |           0 |      0 |

The 115 intended differences are the 109 previously accepted fallback removals
plus the six from this experiment. Historical gates for issues #1–#3, #18, and
#19 freeze their earlier transform sets, so adding this transform does not
reinterpret an earlier result.

## Remaining fallbacks

The nine remaining fallback files are rejected in both prediction modes; LL is
required only to produce the established recovery tree and diagnostics. None of
the six accepted files remains. The public corpus adds two synthetic fixtures
for the accepted classes and participates in every public gate:

| Fixture                  | Control SLL | Control LL | Candidate SLL |
| ------------------------ | ----------- | ---------- | ------------- |
| `edge_declare_specs.pkb` | 2 errors    | accepted   | accepted      |
| `edge_join_alias.pkb`    | 4 errors    | accepted   | accepted      |

The public issue-#20 gate reports 52 identical / 2 intended / 0 defects.

## Threats to validity

- The saved LL work is bounded by the six accepted files; the earlier 4.296 s
  estimate covered all 15 fallbacks and is not presented as an achieved gain.
- Candidate core variance is higher than the control, but the paired interval
  over identical files excludes zero.
- Peak RSS is reported for identity; the candidate reduction is not a controlled
  memory result.
- The nine rejected files keep full-file fallback by design. Localizing their
  recovery would require a separate recovery-tree gate.
- Oracle acceptance and downstream semantic qualification remain external.
