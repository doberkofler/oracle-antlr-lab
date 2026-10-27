# Conclusion

**Status:** root cause identified; cross-runtime conformance passes; Java remains evidence-only.

The 51 differences were not a lexer or grammar defect. The TypeScript observation path applied the production conditional-compilation boundary before lexing; the Java observation path received raw source and therefore emitted `DOLLAR_IF`, `DOLLAR_THEN`, `DOLLAR_ELSE`, and `DOLLAR_END` tokens that TypeScript had hidden.

Applying the same prepared source to both targets makes all 1,244 symbolic token streams and structural parse trees identical. Diagnostics also match at 107. Java still uses LL fallback on 124 files versus TypeScript's 15, but both converge to identical consumer input.

The reusable diagnosis command records first-divergent symbolic tokens without token text or offsets. A public 216-byte fixture reproduces the class, and three focused fixtures cover disabled, enabled, and nested directives.

Adoption still requires a standalone Java preprocessing boundary and external declaration/reference qualification. The 2.30× Java speed advantage remains evidence, not an adoption decision.
