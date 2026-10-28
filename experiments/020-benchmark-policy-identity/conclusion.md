# Conclusion

**Status:** accepted; production benchmark and comparison harness updated.

Every TypeScript production report now records the effective V8 heap limit,
its origin, and the complete DFA cache policy. The limit is read from a child
process spawned the same way as the parser harness, which exposes the important
difference between `NODE_OPTIONS` and a parent command-line flag.

A persistent-cache production-scale campaign below 8,192 MiB now fails before
the first file with the exact setting to change, the bounded-policy alternative,
and the `--allow-unsafe-heap` override. Bounded policies, tail selections, and
the public corpus stay usable under the default heap. The benchmark never raises
the heap automatically, and the report labels the heap and cache policy as a
benchmark configuration rather than a production recommendation.

Comparison rejects different heap or cache identities unless
`--allow-policy-mismatch` is explicit, in which case the override is recorded.
Legacy reports without a heap limit are reported as unrecorded rather than
assumed equal.

## Validation

- Default-heap full-corpus preflight rejected with an actionable message.
- Public full campaign under `NODE_OPTIONS=--max-old-space-size=8192` wrote the
  policy block and passed preflight.
- Self-comparison reported a policy match; an altered 4,192 MiB copy was
  rejected and then accepted only with the recorded override.
- `pnpm verify` passes, including the new policy and comparison tests.

## Limits

The 8,192 MiB threshold is an evidence-based gate for the frozen production
corpus, not a general memory model. The public campaign is a workflow smoke
result, not a performance claim.
