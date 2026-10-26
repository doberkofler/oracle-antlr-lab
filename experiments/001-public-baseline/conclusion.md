# Conclusion

**Status:** accepted as a harness baseline. Not a parser-adoption result.

## Measurement correction

The original interpretation overstated the measured boundary. `adapterMs` and
`setupMs` were timed inside the harness. They do **not** include Node/JVM or
container startup, source loading, or eager generated-module initialization.
`setupMs` measures construction and may include lazy first-use ATN work when that
work occurs in a generated constructor; it does not isolate ATN initialization.
The numerical observations are retained, but the former “JVM setup” conclusion
is withdrawn.

The pass is now described as a cache-reuse pass: each file gets a new parser
instance, while generated static lexer/parser DFA arrays persist in the process
for both adapters.

## Result

| Adapter                 | Cold core p50 | Cold adapter p50 | Cold setup p50 | Warm core p50 | Pass core sum |
| ----------------------- | ------------: | ---------------: | -------------: | ------------: | ------------: |
| TypeScript (`antlr4ng`) |     63.402 ms |        63.901 ms |       0.223 ms |      0.747 ms |    378.776 ms |
| Java (`antlr4-runtime`) |     71.433 ms |     1,516.505 ms |   1,444.112 ms |      0.326 ms |    245.610 ms |

Both adapters completed with zero failures. All 48 public corpus files parsed
without diagnostics, and no selected TypeScript file used the LL fallback.

Both pass values use one process over the 48 selected files. Java uses one JVM
with a parser instance per file; TypeScript uses one Node.js process with a
shared runtime. They are process-level pass approximations, not full production
builds.

## Interpretation

The parser-core numbers are close: 63.4 ms versus 71.4 ms cold, and 0.75 ms
versus 0.33 ms warm. The dominant observed difference is Java first-use
construction plus any lazy generated recognizer initialization: 1,444.1 ms
versus 0.223 ms in TypeScript. Process startup was not timed and cannot be
inferred from these values.

Once the JVM is warm, the Java pass totals 245.6 ms over 48 files, about 5.1 ms
per file. That is lower than the cold parser-core p50 and confirms that process
and JVM reuse matter more than a target-level parse-time difference on this
workload.

This supports separating construction and steady parser work. It provides no
standalone evidence about process or JVM startup.

## Threats to validity

- The corpus is synthetic and small; it does not represent large production
  packages.
- One cold repetition per file. The cold distribution is not stable.
- The cache-reuse pass uses a fresh parser instance per file while generated
  static lexer/parser DFA arrays persist across files.
- No semantic correctness or qualification gate was run.
- JVM class loading and Node/V8 warmup are not decomposed further.
- The public corpus has no SLL fallback cases.

## Next

1. Repeat cold with three repetitions and report variance.
2. Measure process startup, class loading, and ATN initialization explicitly
   before assigning those labels.
3. Add a large-file experiment using a private manifest with opaque paths.
4. Measure SLL fallback and recovery on files with known grammar gaps.
