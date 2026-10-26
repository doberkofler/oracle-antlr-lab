# Conclusion

**Status:** accepted as the stable public harness baseline. Not a
parser-adoption result.

## Result

All 48 files completed on both adapters. Each adapter retained 144 cold
observations (48 files × 3 fresh processes), with zero harness failures and zero
lexer or parser diagnostics.

| Adapter                 | Cold campaign core mean | Sample SD |    CV |          Bootstrap 95% CI | Cache-reuse pass core |
| ----------------------- | ----------------------: | --------: | ----: | ------------------------: | --------------------: |
| TypeScript (`antlr4ng`) |            5,314.789 ms | 72.982 ms | 1.37% | [5,241.617, 5,387.580] ms |            464.815 ms |
| Java (`antlr4-runtime`) |            5,123.846 ms | 59.458 ms | 1.16% | [5,074.846, 5,189.994] ms |            271.650 ms |

The cold campaign totals are stable enough to serve as a regression baseline on
this machine: CV is below 1.4% for both adapters. The three-repeat percentile
bootstrap intervals are descriptive bounds, not strong population confidence;
three independent totals provide low statistical power.

## Measurement boundary

Cold core includes tokenization and parsing. Cold adapter additionally includes
the timed in-process preparation, construction, and bookkeeping. Neither metric
includes Node/JVM/container startup, source loading, or eager generated-module
initialization. Java first-use construction may include lazy generated
recognizer/ATN initialization, but this harness does not isolate that work.

The pass is a cache-reuse pass. Both adapters create a parser per file while
their generated static lexer/parser DFA arrays persist across files in one
process.

## Decision

Use experiment 002 instead of experiment 001 for public-corpus regression
comparisons. Do not extrapolate its synthetic 48-file totals to production. The
next performance claim requires the complete retained production corpus,
file-size strata, full-pass repetition, and peak-process RSS.
