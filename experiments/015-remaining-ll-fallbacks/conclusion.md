# Conclusion

**Status:** no removal candidate accepted.

The previous optimization reduced full-file fallback from 124 to 15 files on the official grammar. The remaining set is not redundant: six files need LL to parse valid input, while nine need LL to produce the established recovery tree and diagnostics.

Removing fallback globally fails correctness. Identity-based routing fails maintainability and generalization. The maximum remaining final-LL cost is only 4.1% of parser core, so further work must target a proven local decision from the TypeScript profile rather than weaken the full-file recovery contract.
