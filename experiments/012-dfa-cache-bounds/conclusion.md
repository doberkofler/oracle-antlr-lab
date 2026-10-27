# Conclusion

**Status:** production policy rejected; experimental controls retained.

Full parser-DFA clearing can reduce peak RSS by 29–41% and restore completion under Node's default heap, but costs 22–38% parser latency in completed candidates. A late 3,800 MiB threshold is substantially worse because it discards learned states immediately before the most expensive files.

No tested policy qualifies as the default under the strict gate. The opt-in controls remain useful for constrained-memory deployments and future selective-cache experiments. A viable production bound requires per-decision eviction or process partitioning that avoids relearning the expensive tail; `antlr4ng` exposes only whole-simulator `clearDFA()` through its public API.
