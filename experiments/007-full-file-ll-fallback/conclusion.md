# Conclusion

**Status:** accepted.

Experiment 003 attributed 45.09% of TypeScript parser core to full-file LL
fallback. This experiment classifies the SLL conflicts behind that fallback and
removes the two dominant families without changing accepted syntax,
diagnostics, or parse trees.

## Classification

The first SLL diagnostic in each fallback file was grouped by the rule that
reported it; later diagnostics were treated as cascade. Two decision families
dominate:

- **Collection methods (66 files).** `aTableData.EXTEND`, `list.DELETE`, and
  `list.TRIM` first fail in `collection_method_call`. `DELETE`, `EXTEND`, and
  `TRIM` are valid `regular_id` tokens, so `general_element` can continue
  through the period. Whether it should continue depends on the caller:
  `collection_method_call` also accepts that period. SLL cannot see the caller
  and continues; LL exits.
- **`BULK COLLECT INTO` (49 files).** `SELECT expr BULK COLLECT INTO ...` first
  fails at `COLLECT`. `BULK` is also a valid select-list alias, so SLL consumes
  it as an alias. LL sees that only `into_clause` can consume the following
  `COLLECT`.

After both changes, 109 files no longer need fallback. The remaining 20 split
into 14 files with genuine grammar gaps that also fail under LL (`DATE`,
`DETECTED`, and `COMPRESSION` as identifiers, `XMLTABLE ... RETURNING SEQUENCE
BY REF`, `DATE NULL`, `JSON_SERIALIZE ... RETURNING`) and 6 additional SLL-only
conflicts that this change does not address.

## Change

Two generated-parser transforms were added, independently selectable for
control runs:

- `collectionMethodCall`: when the token after a period is `DELETE`, `EXTEND`,
  or `TRIM`, resolve the `general_element` loop decision with one full-context
  prediction. The mode is restored immediately, so the rest of the parse stays
  SLL.
- `bulkCollectAlias`: when `BULK COLLECT` follows, skip the select-list alias
  decision and let `into_clause` consume it.

Across one complete SLL pass the local full-context hook ran 278 times and cost
127.4 ms, or 0.15% of SLL time. Ordinary SLL work is therefore unchanged; the
guard is not a second LL fallback.

## Performance

| Scope                  | Control core mean [bootstrap 95% CI] | Candidate core mean [bootstrap 95% CI] |  Change | Candidate CV |
| ---------------------- | -----------------------------------: | -------------------------------------: | ------: | -----------: |
| 12-file tail           |            40.840 s [40.743, 40.963] |              30.252 s [29.631, 31.122] | -25.93% |        2.56% |
| Full 1,244-file corpus |         123.164 s [121.461, 125.469] |              92.241 s [91.840, 92.753] | -25.11% |        0.51% |

Full-corpus wall time fell from 124.855 s to 92.982 s. Peak TypeScript RSS was
effectively unchanged: 4.712 GB control versus 4.673 GB candidate.

### Fallback attribution

| Metric               |  Control | Candidate | Change |
| -------------------- | -------: | --------: | -----: |
| LL fallback files    |      129 |        20 | -84.5% |
| Full-corpus LL mean  | 43.465 s |   4.521 s | -89.6% |
| Tail LL mean         | 13.403 s |   0.740 s | -94.5% |
| Full-corpus SLL mean | 79.104 s |  87.099 s | +10.1% |
| Tail SLL mean        | 27.344 s |  29.414 s |  +7.6% |

Aggregate SLL time rises because 109 files now complete an SLL parse instead of
aborting into recovery. On the 1,115 files that never fell back, the per-file
SLL delta is -0.322 ms mean and +0.006 ms median, so ordinary SLL performance
does not regress. On the 109 changed files, SLL grows from 262.9 ms to 339.5 ms
per file while 358.5 ms of LL fallback disappears.

The first tail control campaign was excluded at 24.32% core CV because of
progressive host slowdown; its samples are retained in
[`measurements.json`](measurements.json). A rerun produced 0.27% CV.

## Conformance

One complete-corpus control pass and one candidate pass were parsed with the
same conditional-compilation preparation and tree digest:

- 0 parse-tree SHA-256 differences across 1,244 files.
- 0 lexer diagnostic, parser diagnostic, visible token, or hidden token
  differences.
- Both states report 181 parser diagnostics.
- 109 files change prediction from `sll-fallback-ll` to `sll` and drop one LL
  attempt. These are the intended fallback removals.

Per-file evidence is in [`conformance.json`](conformance.json). Focused tests
cover collection methods, dotted field access that must remain available,
`BULK COLLECT` with multiple targets, `BULK` as an alias, malformed collection
arguments, an empty `BULK COLLECT` target, and the unsupported `XMLTABLE`
and `DATE NULL` constructs.

The independent per-change gate is retained in
[`009-semantic-conformance`](../009-semantic-conformance/conclusion.md).

## Threats to validity

The tail is deliberately biased to the highest-cost files. Three repetitions
give a descriptive deterministic bootstrap interval, not a production
guarantee. Six SLL-only conflicts remain. The transforms depend on the pinned
antlr-ng generated shape and fail generation when that shape changes. Parse-tree
identity is necessary but not sufficient for semantic acceptance; a promising
candidate still belongs in the external qualification suite.
