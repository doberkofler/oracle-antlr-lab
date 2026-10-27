# Conclusion

**Status:** accepted for conformance; integration is contingent on the upstream
merge and on the pin migration described below.

The eight open `antlr/grammars-v4` PL/SQL pull requests tracked by issue #13
were replayed against their common open-PR base. Every pull request and the
ordered cumulative merge pass the semantic-conformance gate on the complete
1,244-file production corpus and on eleven reduced fixtures. The cumulative
candidate accepts four more production files, removes five full-file LL
fallbacks, and introduces no unexplained parse, token, unit, or diagnostic
difference.

## Grammar states

`grammar/states.json` pins the exact upstream identity of every state and
`grammar/states.lock.json` records the verified upstream and adapted SHA-256
digests. `pnpm grammar:states` reproduces all eleven states, applies the same
reviewed TypeScript adaptation, and three-way merges the cumulative candidate.
Generated parsers remain uncommitted.

| State      | Identity                                   | Adapted lexer  | Adapted parser |
| ---------- | ------------------------------------------ | -------------- | -------------- |
| control    | `8714404279b53fb9856ac6162f468667b0b853bb` | `356626e76e3c` | `622596e33873` |
| pin        | `e199816b3f1a7a49ea1ad84fb6b87c382ea36a33` | `b5330652edcb` | `fecc2f5b4c37` |
| pr-5127    | `4828ebc978916b24f4ee081f25d5c840e751ebe7` | `b2430d2297a3` | `622596e33873` |
| pr-5128    | `0146ee3f3ee1b74ef1b2783d909d4424106db156` | `356626e76e3c` | `a84fe583c17b` |
| pr-5129    | `4c56477163871fb9ba156ddd1b85896d1255d29d` | `df3e3022aa1b` | `101c0fe767e3` |
| pr-5131    | `9ca852617c209c9e6f36cb5c938a6aed7a5100b1` | `356626e76e3c` | `2856612ea877` |
| pr-5132    | `f5cb57f80137f474a9c59a393cc0afef64bb239c` | `356626e76e3c` | `c01e5762dc89` |
| pr-5133    | `4cbc15e8004f1cadd5904a93dfdf430c0c87d1e8` | `356626e76e3c` | `7c569968fd59` |
| pr-5134    | `d7ada8a36e68a7b1c4b1e0bad9e1633c7637880c` | `356626e76e3c` | `6ba45f9aa6d7` |
| pr-5135    | `a7a3f9a8a9895218889e165ab9e1c0c411c5f694` | `356626e76e3c` | `b7fd9351c9ad` |
| cumulative | ordered merge of the eight heads           | `fca301ca2bad` | `fc5d7248dda3` |

The cross-revision oracle hashes rule and token identity by name. This is
required: #5129 inserts the `EXEC` token and #5134 inserts three rules, which
renumbers every later symbol even when the parsed structure is unchanged. The
numeric digest is retained in the harness output but is not the cross-revision
boundary. The three #5134 wrapper rules are flattened by declaration.

## Conformance gates

| Candidate  | Pull request | Corpus identical | Intended | Unsupported | Defects | Fixture result |
| ---------- | -----------: | ---------------: | -------: | ----------: | ------: | -------------- |
| pr-5127    |        #5127 |            1,244 |        0 |           0 |       0 | pass           |
| pr-5128    |        #5128 |            1,243 |        1 |           0 |       0 | pass           |
| pr-5129    |        #5129 |            1,241 |        0 |           3 |       0 | pass           |
| pr-5131    |        #5131 |            1,239 |        3 |           2 |       0 | pass           |
| pr-5132    |        #5132 |            1,242 |        2 |           0 |       0 | pass           |
| pr-5133    |        #5133 |            1,244 |        0 |           0 |       0 | pass           |
| pr-5134    |        #5134 |            1,244 |        0 |           0 |       0 | pass           |
| pr-5135    |        #5135 |            1,244 |        0 |           0 |       0 | pass           |
| cumulative |            — |            1,236 |        6 |           2 |       0 | pass           |

Control totals: 1,231 accepted files, 176 parser diagnostics, 19 full-file LL
fallbacks, 1,308 script units. Cumulative totals: 1,235 accepted files, 107
parser diagnostics, 14 fallbacks, 1,303 script units.

The corpus transitions are all declared with opaque identity, SHA-256,
direction, and reason in [`corpus-policy.json`](corpus-policy.json):

- #5128 accepts `source-001143.pkb`, which uses `XMLTABLE ... RETURNING
  SEQUENCE BY REF`; its parser diagnostics fall from 47 to zero.
- #5131 accepts `source-000571.pks`, `source-001056.pkb`, and
  `source-001150.pkb` by allowing `DATE`, `DETECTED`, and `ENCLOSED` as
  identifiers.
- #5132 removes one full-file LL fallback with an identical tree and re-parents
  a parenthesised subquery's set operation in `source-001242.pkb` to the
  enclosing subquery. Acceptance, units, tokens, diagnostics, and the rule-name
  multiset are unchanged.
- #5129 leaves three already-rejected files rejected while recovery changes
  because `EXEC` enters the token vocabulary. #5131 leaves two already-rejected
  files rejected. These are classified as unsupported syntax, not as semantic
  changes.

#5127, #5133, #5134, and #5135 have no production-corpus difference at all.
#5134 also rejects the negative `ALTER TABLE t;` fixture while keeping every
valid `ALTER TABLE` action form accepted.

## Fixtures

Eleven reduced fixtures are imported with provenance into
`corpora/upstream-prs`. Each declared transition was observed exactly:

- #5127, #5128, #5129, #5131, #5133, and #5135 move their fixtures from
  rejected to accepted.
- #5134 moves `ALTER TABLE t;` from accepted to rejected and keeps the valid
  action fixture accepted.
- #5132 keeps the reduced set-operation fixture accepted with an identical
  tree.

## Oracle validation

Read-only SQL forms were validated against a local Oracle 23 database:

- the three #5132 SELECT forms parse (`EXPLAIN PLAN`);
- both #5135 `JSON_VALUE ... RETURNING TIMESTAMP [WITH TIME ZONE]` forms parse;
- the #5128 form `XMLTABLE('/x' PASSING XMLTYPE(...) RETURNING SEQUENCE BY REF
  COLUMNS ...)` parses.

Two forms in the upstream #5128 example are rejected by Oracle 23.26:

- `XMLTABLE('/x' RETURNING SEQUENCE BY REF)` fails with ORA-02000 (missing
  `COLUMNS`);
- `PASSING BY VALUE expr` fails with ORA-00936 on this database, although the
  documentation marks `BY VALUE` as optional.

The grammar change is still required for the valid forms. The upstream example
should be corrected; the laboratory fixture keeps the upstream text for
provenance. The #5131, #5133, and #5134 fixtures require creating packages,
tables, or analytic views and were not executed because the experiment has no
DDL approval.

## Migration from the current pin

The current pin is not the common open-PR base. Compared with the pin, the
control differs on 445 of 1,244 files: 443 symbolic trees, one acceptance
transition, one fallback change, and five diagnostic sequences. The control
accepts one more file and reports five fewer parser diagnostics. The open PRs
therefore cannot be applied to the pin without first absorbing upstream master,
and this experiment does not attribute those differences to the PRs.

## Performance

All campaigns used fresh Node.js processes, the same optimized generated-parser
state, and the same corpus fingerprint per selection. A change is claimed only
when every repetition moves in the same direction, the paired mean 95% CI
excludes zero, and the difference is at least 1% of the control parser core.

| Campaign          | State      | Parser core p50 |           Paired delta | Claim       |
| ----------------- | ---------- | --------------: | ---------------------: | ----------- |
| tail, 12 files    | control    |     30,421.9 ms |                      — | —           |
| tail, 12 files    | #5132      |     23,503.6 ms |  −6,842.6 ms (−22.48%) | improvement |
| tail, 12 files    | cumulative |     30,391.3 ms |        noise-dominated | no change   |
| Q4, 311 files     | control    |    121,470.6 ms |                      — | —           |
| Q4, 311 files     | #5132      |    116,362.6 ms |   −7,671.3 ms (−6.22%) | no change   |
| Q4, 311 files     | cumulative |    128,431.3 ms |   +7,748.2 ms (+6.28%) | no change   |
| full, 1,244 files | control    |    131,602.4 ms |                      — | —           |
| full, 1,244 files | cumulative |    131,977.8 ms |   +1,215.8 ms (+0.92%) | no change   |
| full, 1,244 files | #5132      |    159,916.7 ms | +15,957.8 ms (+12.85%) | no change   |

#5132 removes the redundant `subquery_operation_part` from `atom` and produced a
22.5% reduction in one tail campaign whose repetitions were unusually stable
(0.55% and 1.04% CV). That signal did not reproduce: the Q4 campaign was
−6.22% with an interval that includes zero, and the full-corpus campaign was
inconclusive. The cumulative candidate is neutral on the full corpus; the five
removed fallbacks do not translate into a measurable full-corpus latency
change. Full-file peak RSS was higher for the cumulative candidate in the first
full campaign (6.77 GB versus 5.72 GB), so a memory claim is neither made nor
excluded.

The host drifted by a factor of two to four across campaigns: the full-corpus
control p50 moved from 131.6 s to 92.0 s between campaigns, and individual
repetitions reached 188.6 s. Campaign-local paired comparisons remain the only
valid evidence, and even those are weakened by sequential control/candidate
sampling. The tail rerun and the full #5132 campaign are retained under
[`tail-rerun-report.md`](tail-rerun-report.md) and
[`full-5132-report.md`](full-5132-report.md); no latency improvement is claimed
beyond the single tail screening result.

## Decision

Include all eight changes in the cumulative candidate on conformance grounds:
they are individually conformant, and the cumulative merge adds four accepted
production files and removes five fallbacks without a measurable full-corpus
cost. No speedup is claimed; the #5132 tail signal is not confirmed on the Q4 or
full selections. #5127, #5128, #5129, #5131, #5132, #5133, #5134, and #5135
each satisfy their declared fixture transition.

Integration order: merge the upstream pull requests, then advance the
laboratory pin to a commit that contains them, then rerun
`pnpm grammar:states -- --check`, `pnpm conformance`, and the paired benchmark.
The local #5030 adaptation must stay conditional: grammars after the merged
#5030 carry `IsQQuoteDelimiter` themselves, and the laboratory injects that
method into its lexer base instead of replacing the upstream rule.

## Reproduction

```bash
pnpm grammar:states
pnpm conformance:grammar -- --manifest <private-manifest> \
  --corpus-policy experiments/010-upstream-grammar-prs/corpus-policy.json \
  --experiment 010-upstream-grammar-prs \
  --publish experiments/010-upstream-grammar-prs
pnpm benchmark:grammar -- --states control,pr-5132,cumulative \
  --selection tail --experiment 010-upstream-grammar-prs-tail
pnpm benchmark:grammar -- --states control,pr-5132,cumulative \
  --selection q4 --experiment 010-upstream-grammar-prs-q4
pnpm benchmark:grammar -- --states control,cumulative \
  --selection full --experiment 010-upstream-grammar-prs-full
```

Evidence: [`conformance.json`](conformance.json),
[`conformance.md`](conformance.md), [`migration.json`](migration.json),
[`migration.md`](migration.md), [`tail-report.md`](tail-report.md),
[`q4-report.md`](q4-report.md), [`full-report.md`](full-report.md), and
[`full-5132-report.md`](full-5132-report.md).

## Threats to validity

- Parse-tree identity is necessary but not sufficient for semantic acceptance;
  declarations, references, and dependencies are not extracted.
- The cross-revision symbolic digest cannot detect a semantic change that keeps
  rule and token names unchanged.
- The corpus is frozen and does not necessarily exercise every grammar path.
- The reduced fixtures are not a replacement for the upstream example suite or
  external qualification.
- Three of the fixture groups require DDL or schema objects and were not
  executed against Oracle.
- Benchmark variance on this host is high enough that the Q4, full, and one
  tail campaign are inconclusive; only one tail screening campaign supports the
  #5132 improvement signal, and it is not confirmed end-to-end.
