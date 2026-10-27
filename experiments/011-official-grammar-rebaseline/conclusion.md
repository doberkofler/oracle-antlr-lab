# Conclusion

**Status:** accepted as the official-grammar baseline; TypeScript production viability regressed.

The official grammar completes the frozen corpus only with an 8 GB Node old-space limit. Under the default approximately 4 GB limit, the first TypeScript pass fails at file 1,243 of 1,244.

TypeScript parser core is 103.888 s versus the prior optimized 92.241 s: **+12.6%**. Peak RSS rises from the historical 4.710 GB baseline to 6.546 GB. Diagnostics remain 107 and optimized full-file LL fallbacks improve from 20 to 15. Every optimization conformance gate passes with zero defects.

Java parser core is 45.234 s with 367 diagnostics, improved from the historical 486 diagnostics but still ineligible for adoption. Cross-runtime semantic conformance is required.

The next optimization must bound TypeScript DFA retention and restore completion under the default Node heap before further latency work is accepted.
