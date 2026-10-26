# Conclusion

**Status:** accepted.

The optimization sequence from issues #1–#3 was rerun through a semantic
conformance gate. Each change was compared with the state immediately before it,
and the combined final state was compared with the unoptimized parser. All four
gates passed on the complete frozen 1,244-file production corpus.

## Gates

| Gate                                       | Issue | Control                                               | Candidate                                             | Identical | Intended | Defects |
| ------------------------------------------ | ----: | ----------------------------------------------------- | ----------------------------------------------------- | --------: | -------: | ------: |
| `issue-1-general-element-part`             |    #1 | none                                                  | `generalElementPart`                                  |     1,244 |        0 |       0 |
| `issue-2-routine-name-and-general-element` |    #2 | `generalElementPart`                                  | `generalElement`, `generalElementPart`, `routineName` |     1,244 |        0 |       0 |
| `issue-3-full-file-ll-fallback`            |    #3 | `generalElement`, `generalElementPart`, `routineName` | all five transforms                                   |     1,135 |      109 |       0 |
| `combined-final`                           |    #6 | none                                                  | all five transforms                                   |     1,135 |      109 |       0 |

Each gate generated its control and candidate parsers independently from the
pinned grammar and parsed every file in a fresh Node.js process. The checked-in
generated parser was not modified.

## Equivalence evidence

The oracle compares top-level `script_unit` count, structural parse-tree
SHA-256, accepted status, visible and hidden token counts, lexer and parser
diagnostic counts, the ordered diagnostic digest, and prediction behavior. Parse
trees retain rule indices, child counts, terminal token types, and tree shape;
the published digest excludes token text and source offsets.

Across all four gates:

- 0 parse-tree differences.
- 0 accepted-unit differences; both states report 1,308 units.
- 0 acceptance-status differences; both states accept 1,230 files.
- 0 lexer diagnostic differences and 0 visible or hidden token differences.
- 0 parser diagnostic differences; both states report 181 diagnostics.
- 0 diagnostic-sequence differences.

Issues #1 and #2 had no observable differences at all.

Issue #3 and the combined final state removed full-file LL fallback from 109
files. Those files change prediction from `sll-fallback-ll` to `sll` and drop
one LL attempt while keeping the same parse tree, accepted units, acceptance
status, tokens, and diagnostics. This is the only intended difference; it is
covered by focused tests for collection-method access, `BULK COLLECT`, and
`BULK` as a select-list alias.

## Acceptance criteria

- Every grammar or parser-recovery change from #1–#3 has its own gate.
- No unexplained semantic, diagnostic, token, unit, or recovery difference
  remains; every changed file is classified as intended.
- Intended differences are documented and covered by focused tests.
- Java remains outside the gate: its unmodified target retains 486 production
  diagnostics, so its faster parser core is not semantic acceptance evidence.
- The final performance conclusion includes latency, memory, and conformance
  status in the [problem register](../../docs/problem-register.md).
- The published artifact contains opaque identities, byte sizes, and digests
  only; no source text, original path, object name, or diagnostic message.

Final TypeScript parser core is 92.241 s against the 156.093 s unoptimized
baseline, a 40.9% reduction and 1.69× speedup. Experiment 008 attributes 90–96%
of retained heap to generated DFA caches and makes no memory-optimization claim
from the latency work.

## Reproduction

```bash
pnpm conformance -- --manifest <private-manifest> \
  --experiment 009-semantic-conformance \
  --publish experiments/009-semantic-conformance
```

The complete gate evidence is in [`conformance.json`](conformance.json) and
[`conformance.md`](conformance.md). The public smoke run is part of CI.

## Threats to validity

- Parse-tree identity is necessary but not sufficient for semantic acceptance.
  The laboratory does not extract declarations, references, or dependencies;
  identical parse trees bound the input to a semantic consumer, but external
  qualification remains required.
- The corpus is frozen and exercises only the syntax and recovery paths it
  contains.
- Java has no equivalent generated-parser optimization states and cannot be
  compared on the same gates.
- The generated-parser transforms depend on the pinned antlr-ng output shape and
  fail generation when that shape changes.
- A passing conformance gate does not replace the external qualification suite.
