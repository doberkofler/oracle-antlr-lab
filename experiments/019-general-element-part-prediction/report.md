# Bounded `general_element_part` argument prediction

Replacing decision 2993 with bounded lookahead removes a third of the remaining
parser core time on the complete opaque corpus.

| State     | Core mean | Core CV | Δ core | Peak RSS mean | Peak RSS max | Fallback files | Diagnostics |
| --------- | --------: | ------: | -----: | ------------: | -----------: | -------------: | ----------: |
| Control   | 108.019 s |   4.64% |      — |      6.423 GB |     6.894 GB |             15 |         107 |
| Candidate |  71.717 s |   0.56% | −33.6% |      5.355 GB |     5.635 GB |             15 |         107 |

Against the same-session control the candidate is **1.51× faster**. Against the
official-grammar baseline in experiment 011 (`103.888 s`) it is **31.0% faster**,
and against the pre-issue-#1 baseline (`156.093 s`) it is **54.1% faster**, or
**2.18×**.

All 1,244 files remain structurally identical. Fallback files and diagnostics
are unchanged at 15 and 107.

## Decision evidence

The pre-change parser was instrumented at decision 2993 during one complete
corpus pass:

|  Calls | LL-path calls | Continue (alt 1) | Exit (alt 2) |
| -----: | ------------: | ---------------: | -----------: |
| 55,402 |         2,605 |           55,248 |          154 |

Only two exit shapes occurred:

| Exit shape | Count | Meaning                                                      |
| ---------- | ----: | ------------------------------------------------------------ |
| `( + )`    |   152 | Oracle outer-join marker                                     |
| `( TREAT`  |     2 | `TREAT` parenthesized syntax is not a function-argument list |

Every other parenthesis after a `general_element_part` was an argument list.
The `(+)` case is provable from the grammar: `function_argument` cannot match a
lone `+`, so continuing is impossible. `TREAT` is the only observed construct
whose parenthesized syntax must be left to the caller, so it keeps the original
context-sensitive prediction. The transform also rejects the fast path after a
syntax error, preserving the recovery path used by the earlier `routine_name`
change.

## Transform

The generated parser previously ran adaptive prediction for every `LEFT_PAREN`:

```ts
while (this.tokenStream.LA(1) === PlSqlParser.LEFT_PAREN) {
	alternative = this.interpreter.adaptivePredict(this.tokenStream, 2993, this.context);
	if (alternative !== 1) {
		break;
	}
	this.function_argument();
}
```

The candidate resolves the decision from three tokens:

```ts
alternative =
	this.numberOfSyntaxErrors === 0
		? this.tokenStream.LA(2) === PlSqlParser.PLUS_SIGN && this.tokenStream.LA(3) === PlSqlParser.RIGHT_PAREN
			? 2
			: this.tokenStream.LA(2) === PlSqlParser.TREAT
				? this.interpreter.adaptivePredict(this.tokenStream, 2993, this.context)
				: 1
		: this.interpreter.adaptivePredict(this.tokenStream, 2993, this.context);
```

The generated grammar, ATN state assignment, and visitor surface are unchanged.
The transform is generated-parser post-processing, not a local grammar patch, so
there is no target-independent grammar change to send upstream.

## Conformance

The issue-specific gate compared the five established transforms against the
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
removals. There are no new differences in parse trees, token counts, accepted
units, diagnostics, diagnostic sequences, prediction mode, or fallback attempts.
Decision 2993 recorded zero ambiguities in both the control and candidate
profiles, and the full-file fallback count remained 15.

Evidence artifacts: [`conformance.json`](conformance.json) and
[`combined-conformance.json`](combined-conformance.json).

## Public fixtures

`pnpm corpus:public` now also generates:

- `edge_outer_join.sql` — valid `(+)` outer join and `func(+1)` unary argument.
- `edge_treat.sql` — valid `TREAT(... AS json)`.
- `edge_argument_recovery.sql` — an invalid statement followed by a valid
  function call, exercising the post-error prediction path.

The two valid fixtures parse without diagnostics; the recovery fixture retains
its LL fallback and parser diagnostic.

## Measurement

Both states used three fresh-process cache-reuse passes over the complete
corpus. Control:

```text
105.354 s, 103.658 s, 115.045 s
```

Candidate:

```text
71.150 s, 72.062 s, 71.939 s
```

The candidate variance is much lower because the dominant prediction path is no
longer sensitive to DFA growth in the expensive tail. Java was measured as an
unchanged control: `49.942 s` control mean versus `49.954 s` candidate mean,
with identical 144 fallback files and 367 diagnostics.

A post-change instrumented profile of the 12 highest-cost files still attributes
6.0 s to decision 2993. Those files include recovery paths and `TREAT` calls, so
prediction remains active there. The uninstrumented full-corpus result is the
acceptance measure. The comparable control attribution is 16.4 s for 10,622
calls; the reduced candidate attribution is in
[`profile-summary.json`](profile-summary.json).

## Threats to validity

- Control variance was 4.64%, driven by host load during the control session.
  The candidate is 33.6% faster with 0.56% variance, so the direction and
  magnitude are not sensitive to that noise.
- Decision attribution comes from one instrumented pass. The 154 exit shapes are
  an empirical census of this frozen corpus, not a proof over all Oracle syntax.
  The transform therefore keeps prediction for the only non-`(+)` observed exit
  (`TREAT`) and after syntax errors.
- Peak RSS is a process high-water mark and includes harness retention. It is
  not a post-GC retained-memory measurement.
- The transform is TypeScript generated-parser post-processing. Java uses the
  unchanged grammar and was not requalified as a replacement.
- Structural conformance bounds parser input only. External declaration and
  reference qualification remains required.

## Decision

Accept. The bounded lookahead removes the decision-2993 hotspot with zero
structural differences and a repeatable one-third reduction in default parser
core time. It becomes part of the default generated TypeScript parser.
