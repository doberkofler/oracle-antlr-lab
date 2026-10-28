# First-token `unary_expression_core` prediction

Replacing decision 2595 with first-token selection cuts another 7.7% of parser
core time on the complete opaque corpus with no structural difference.

| State     | Core mean | Core CV | Δ core | Peak RSS mean | Peak RSS max | Fallback files | Diagnostics |
| --------- | --------: | ------: | -----: | ------------: | -----------: | -------------: | ----------: |
| Control   |  68.140 s |   0.52% |      — |      4.920 GB |     5.217 GB |             15 |         107 |
| Candidate |  62.913 s |   1.05% |  −7.7% |      4.621 GB |     4.981 GB |             15 |         107 |

The paired per-file delta is **−4.201 ms [−4.812, −3.657]**, which excludes zero.
Against the official-grammar baseline in experiment 011 (`103.888 s`) the
candidate is **39.4% faster**, and against the pre-issue-#1 baseline
(`156.093 s`) it is **59.7% faster**, or **2.48×**.

All 1,244 files remain structurally identical. Fallback files and diagnostics are
unchanged at 15 and 107.

## Decision evidence

Decision 2595 has six alternatives. Four start with tokens that cannot begin
`standard_function`:

| Alternative | Rule                             | Distinguishing first token          |
| ----------- | -------------------------------- | ----------------------------------- |
| 1           | `case_expression`                | `CASE`                              |
| 2           | `quantified_expression`          | `SOME`, `EXISTS`, `ALL`, `ANY`      |
| 3           | `standard_function`              | function keywords and generic names |
| 4           | `atom`                           | literals, bind variables, names     |
| 5           | `implicit_cursor_expression`     | `SQL` followed by `%BULK_*`         |
| 6           | `selection_directive_expression` | `$IF`                               |

`standard_function` and `atom` overlap for a generic name. `standard_function`
reaches a plain name only through `regular_id function_argument_modeling`, which
requires a `USING` modeling clause, or through `cursor_name` followed by a cursor
attribute. Every other `standard_function` branch starts with a dedicated
function keyword. `atom`'s predicate excludes the numeric aggregates followed by
`LEFT_PAREN`.

The same-session tail profile shows the effect:

| Metric                    |  Control | Candidate | Change |
| ------------------------- | -------: | --------: | -----: |
| Decision-2595 time        | 4,065 ms |  2,228 ms | −45.2% |
| Adaptive-prediction calls |   54,548 |     1,604 | −97.1% |
| SLL ATN transitions       |    5,549 |     2,010 | −63.8% |
| LL fallbacks              |      254 |       250 |  −1.6% |
| Recorded ambiguities      |    1,090 |     1,079 |    −11 |
| Profile elapsed           |   26.0 s |    23.8 s |  −8.7% |

The remaining prediction calls are the dedicated function keywords, cursor
attributes, `CASE`, and `TIME` literals.

## Transform

The generated parser previously ran one adaptive prediction per invocation:

```ts
switch (this.interpreter.adaptivePredict(this.tokenStream, 2595, this.context) ) {
```

The candidate resolves the decision from two tokens and the generated ATN:

```ts
if (first === PlSqlParser.CASE) {
	return this.interpreter.adaptivePredict(this.tokenStream, decision, this.context);
}

if (second === PlSqlParser.LEFT_PAREN) {
	// Numeric aggregates: the atom predicate rejects these.
	// Quantified expressions: only alternative 2 can match.
	// Otherwise a dedicated standard-function keyword or a USING clause predicts;
	// every other argument list is atom.
	return PlSqlParser.unaryExpressionCoreStandardTokens(standardState).has(first) || this.unaryExpressionCoreUsesModelingClause()
		? this.interpreter.adaptivePredict(this.tokenStream, decision, this.context)
		: 4;
}

// Cursor attributes, $IF, SQL%BULK_*, and TIME literals keep prediction.
return PlSqlParser.unaryExpressionCoreAtomTokens(atomState).has(first) ? 4 : this.interpreter.adaptivePredict(this.tokenStream, decision, this.context);
```

The dedicated-keyword set is derived once from the generated ATN by walking
alternative 3 while skipping `regular_id`, `id_expression`, and `cursor_name`.
Hard-coding the keyword list would silently break when the pinned grammar
changes; the ATN walk cannot omit a dedicated branch.

### Malformed input

`CASE` is a non-reserved keyword. On malformed input such as
`CASE WHEN a IS JSON(STRICT) THEN …`, alternative 1 cannot match the condition,
so adaptive prediction correctly falls back to `atom` and then recovers at
`a`. Returning alternative 1 unconditionally changed both the tree and the
diagnostic sequence on one corpus file. `CASE` therefore keeps prediction. All
other fast paths select an alternative that is the only one able to match the
next two tokens, so their choice is the same before and after a syntax error.

## Conformance

The issue-specific gate compared the six established transforms against the
candidate over all 1,244 files:

| Compared | Identical | Intended | Unsupported | Defect |
| -------: | --------: | -------: | ----------: | -----: |
|    1,244 |     1,244 |        0 |           0 |      0 |

The combined gate compared the unoptimized parser against the full candidate
state:

| Compared | Identical | Intended | Unsupported | Defect |
| -------: | --------: | -------: | ----------: | -----: |
|    1,244 |     1,135 |      109 |           0 |      0 |

The 109 intended differences are the previously accepted full-file LL fallback
removals from issues #2 and #3; no new difference was introduced.

## Public fixtures

`corpora/public/files/edge_unary_expression.sql` adds signed operands, nested
expressions, function calls, searched and parenthesized simple `CASE`,
`EXISTS`/`ANY`, cursor attributes, `SQL%ROWCOUNT`, `SQL%BULK_ROWCOUNT`,
`SQL%BULK_EXCEPTIONS`, and an aggregate `OVER` clause.
`edge_argument_recovery.sql` adds a unary operator without an operand.
`test/generatedParserOptimization.test.ts` covers the transform shape, every
alternative, the malformed-expression path, and the public fixtures participate
in every public conformance gate.

## Threats to validity

- The dedicated-keyword set is computed from the generated ATN at first use; a
  grammar change alters it automatically, but the transform's shape assertions
  must still match the new generated code.
- `function_argument_modeling` is the only `standard_function` path entered by a
  generic name, so a plain argument list without `USING` is resolved as `atom`
  after scanning for a depth-one `USING`; the scan is linear in the argument
  list and stops at the matching parenthesis.
- The Java adapter is unchanged by this work. Its `+3.15%` paired change in the
  comparison is session drift, not a parser change, and is not used as evidence.
- The tail profile uses `ProfilingATNSimulator`, which inflates absolute
  latency; the invocation and transition counts are the useful outputs.
- Only the frozen production corpus and the public synthetic corpus were
  exercised. Oracle acceptance and downstream semantic qualification remain
  external.
