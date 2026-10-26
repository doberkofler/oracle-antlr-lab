# Contributing

This repository measures parser behavior. It does not ship an Oracle adapter.

## Before opening a change

1. State the question the change answers.
2. Record the corpus, grammar, patch, runtime, and repetition identities.
3. Run the control and candidate through the same manifest.
4. Keep the result even when it contradicts the hypothesis.

## Grammar changes

Never edit `grammar/upstream/`, `grammar/adapted/`, or generated code by hand.

A grammar change is a new reviewed patch in `grammar/patches/` plus:

- the reason;
- the affected rule;
- a reduced fixture;
- an acceptance run and a prediction-cost run;
- a per-change semantic-conformance result from `pnpm conformance`;
- an upstream issue or pull request when the defect is target-independent.

## Benchmarks

Use `pnpm benchmark`, not `benchmark:quick`, for reportable results. Quick runs
exist only to validate the harness.

Promote a report only after it has a conclusion and a threat-to-validity note.

## Privacy

Do not commit private source, private paths, credentials, or reports that expose
them. A private corpus manifest belongs outside this repository.

## Checks

```bash
pnpm verify
```
