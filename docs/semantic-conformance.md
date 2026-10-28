# Semantic Conformance Gate

A parser optimization is not accepted until it preserves the parser's observable
semantics. This document defines the oracle, the required equivalence
boundaries, and how a difference is classified.

## Status

TypeScript changes from issues #1–#3, #18, and the combined final state are gated by
[`experiment 009`](../experiments/009-semantic-conformance/conclusion.md) and
[`experiment 019`](../experiments/019-general-element-part-prediction/conclusion.md).
Java remains an unmodified control. The Java target retained 486 parser
diagnostics on the frozen production corpus in
[`experiment 003`](../experiments/003-production-scale/conclusion.md); its
constant-factor speed result is not semantic acceptance evidence and does not
make it a viable replacement.

## Oracle

Every gate compares two complete passes over the same manifest, file identities,
and SHA-256 digests.

| Boundary          | Required comparison                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lexing            | Visible and hidden token counts; lexer diagnostic count and ordered diagnostic digest.                                        |
| Accepted units    | Top-level `script_unit` count plus structural parse-tree SHA-256.                                                             |
| Parse structure   | Structural parse-tree SHA-256 over rule indices, child counts, terminal token types, and tree shape.                          |
| Diagnostics       | Lexer and final parser diagnostic counts plus SHA-256 over line, column, and message sequence. Message text is not published. |
| Recovery behavior | Final parse tree, accepted-unit count, and final diagnostic sequence must match.                                              |
| Prediction        | `prediction`, `sllAttempts`, and `llAttempts` are compared but are not semantic fields.                                       |
| Declarations      | Not extracted. Identical parse trees bound the input to a semantic consumer; external qualification remains required.         |
| References        | Not extracted. Same boundary as declarations.                                                                                 |
| Dependencies      | Not extracted. Same boundary as declarations.                                                                                 |

The structural digest deliberately excludes token text and source offsets so it
can be published for a private corpus. It is necessary but not sufficient for
semantic acceptance: the repository does not implement an Oracle symbol index,
reference resolver, or PL/Scope qualification.

## Difference classification

Each changed file receives one classification:

- **Intended** — only the declared field transition occurs. The current policy
  allows only full-file LL fallback removal (`sll-fallback-ll` → `sll`, one LL
  attempt → zero) with identical parse tree, accepted units, tokens, and
  diagnostics.
- **Unsupported** — an explicitly allowlisted file that both states reject. It
  is retained as unsupported syntax and still requires external classification.
- **Defect** — any other difference. The gate fails.

A gate passes only when no file is a defect. A changed acceptance status, parse
tree, accepted-unit count, token count, or diagnostic sequence is always a
defect unless the file is explicitly classified as unsupported.

## Change sets

The checked-in change sets are:

| Gate                                       | Issue | Experiment                              | Control                                               | Candidate                                             |
| ------------------------------------------ | ----: | --------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `issue-1-general-element-part`             |    #1 | `005-general-element-part-optimization` | none                                                  | `generalElementPart`                                  |
| `issue-2-routine-name-and-general-element` |    #2 | `006-routine-name-and-general-element`  | `generalElementPart`                                  | `generalElement`, `generalElementPart`, `routineName` |
| `issue-3-full-file-ll-fallback`            |    #3 | `007-full-file-ll-fallback`             | `generalElement`, `generalElementPart`, `routineName` | the five transforms accepted by issue #3              |
| `issue-18-general-element-part-prediction` |   #18 | `019-general-element-part-prediction`   | the five transforms accepted by issue #3              | all six transforms                                    |
| `combined-final`                           |    #6 | `009-semantic-conformance`              | none                                                  | all six transforms                                    |

Every grammar or parser-recovery commit must have its own gate. A final combined
result does not replace the per-change result.

## Commands

```bash
# All gates over the private production corpus.
pnpm conformance -- --manifest .work/private-production/manifest.json \
  --experiment 009-semantic-conformance \
  --publish experiments/009-semantic-conformance

# One gate.
pnpm conformance -- --manifest .work/private-production/manifest.json \
  --change-set issue-3-full-file-ll-fallback

# Public smoke run.
pnpm conformance -- --manifest corpora/public/manifest.json --experiment conformance-smoke
```

`--ids` restricts a run to a deterministic id subset. `--dry-run` prints the
generated states and change sets without parsing.

Each state is generated into `.work/conformance/<experiment>/<state>/generated`
and parsed in a fresh Node.js process. The checked-in
`grammar/typescript/generated` tree is not modified.

## Published evidence

`results/<experiment>/conformance.json` retains every gate result. With
`--publish`, the same artifact is copied to the experiment directory.

A published artifact contains:

- opaque file identities, byte sizes, and SHA-256 digests;
- per-gate difference counts and classifications;
- all field values for changed files only;
- an evidence digest over every compared row;
- no source text, original path, object name, or diagnostic message.

Private manifests are rejected unless every published identity matches
`source-<six digits>.<extension>`.

## Limitations

- Parse-tree identity is a proxy for semantic equivalence, not a semantic proof.
- Typed and untyped PL/SQL, conditional compilation, and all recovery paths are
  represented only as far as the frozen corpus exercises them.
- Java has no TypeScript generated transforms and cannot be compared on the same
  optimization states. Its 486 diagnostics remain an open semantic blocker.
- The gate does not replace the external qualification suite.
