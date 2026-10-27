# Conclusion

**Status:** seam accepted; consumer migration deferred.

`parseSourceStreaming` provides a no-retained-tree path without changing `parseSource`. It disables parse-tree construction and accepts a transactional listener sink. Clean SLL parses commit directly; an SLL failure rolls back consumer state before the LL attempt, and only LL is committed.

Focused tests prove event delivery, single-attempt commit, and observation parity for diagnostics, tokens, and prediction. The prior memory profile measured 43.4 MB of retained TypeScript tree for the representative 370 kB file; streaming consumers can avoid that per-file retained object graph. This does not solve the multi-gigabyte shared DFA cache and does not claim a full-corpus latency gain.

No production consumer exists in this laboratory, so automatic migration would be false evidence. Downstream consumers can adopt the seam while the retained-tree API remains compatible.
