# Conclusion

**Status:** rejected for adoption.

Java is 2.30× faster in the official-grammar production baseline, and diagnostics improve from the historical 486 to 367. It nevertheless differs from optimized TypeScript on 51 of 1,244 files, including structural parse-tree differences in every changed file and parser-diagnostic differences in 26 files.

Java remains an evidence-only control. The new `conformance:cross-runtime` gate makes future requalification reproducible; adoption requires all 1,244 files to pass or each difference to receive an explicit, externally validated intended classification.

## Follow-up

Experiment 017 identified these 51 differences as an input-boundary mismatch: the Java observation path received raw source while TypeScript applied conditional-compilation preprocessing. With identical prepared input, all 1,244 files pass. Adoption still requires a standalone Java preprocessing boundary and external declaration/reference qualification.
