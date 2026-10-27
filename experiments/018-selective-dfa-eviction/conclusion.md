# Conclusion

**Status:** accepted as an opt-in memory bound; production default unchanged.

Per-decision DFA eviction restores completion under Node's default heap with a
12.0% core-latency cost, compared with 22–38% for whole-cache clearing. On the
complete 1,244-file corpus it reduces peak RSS from 6.546 GB to 4.816 GB
(26.4%) and final retained states from 163,215 to 65,484 (59.9%), with zero
parse-tree, token, diagnostic, acceptance, or fallback differences.

The bound works because the cache is concentrated: decision 2993 in
`general_element_part` holds 64.5% of all states and grows sharply in the final
44 files. The selected policy caps the four highest-value decisions at 90,000
states and every other decision at 2,000 states, enforced every 10 files. A full
pass performs eight decision resets, one of them for decision 2993.

The production default remains the persistent cache. A 12% regression is still a
regression, and the control completes when given an 8 GB old-space limit.
Selective eviction is the correct choice when the process must run under the
default heap or another explicit memory ceiling.

Heap-triggered enforcement was rejected. Its enforcement point depends on
garbage-collection timing, and repeated runs varied from 110.3 s to 174.0 s with
different retained-state counts; one run recorded a 1,046 s wall-clock gap.
Whole-cache clearing remains rejected for the same reason it was rejected in
experiment 012: it discards every learned state, including the expensive tail.
A cold-only bound also fails because it leaves decision 2993 unbounded.

## Follow-up

The next memory step is not another eviction trigger. It is to reduce the cost of
decision 2993 itself, either through a localized prediction transform or a
grammar-level simplification. Any such change must pass the complete structural
conformance gate and preserve the 15-file LL fallback behavior.
