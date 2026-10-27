# Conclusion

**Status:** rejected for adoption.

Java is 2.30× faster in the official-grammar production baseline, and diagnostics improve from the historical 486 to 367. It nevertheless differs from optimized TypeScript on 51 of 1,244 files, including structural parse-tree differences in every changed file and parser-diagnostic differences in 26 files.

Java remains an evidence-only control. The new `conformance:cross-runtime` gate makes future requalification reproducible; adoption requires all 1,244 files to pass or each difference to receive an explicit, externally validated intended classification.
