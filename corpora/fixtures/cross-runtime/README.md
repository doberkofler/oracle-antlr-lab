# Cross-runtime fixtures

Reduced public sources for differences found between the TypeScript and Java
targets.

- `conditional-disabled.sql`: `$if false` hides the then-branch.
- `conditional-enabled.sql`: `$if true` hides the else-branch.
- `conditional-nested.sql`: a disabled outer branch contains an inner directive.

All three fail raw cross-runtime token equality because the Java harness did not
apply the production conditional-compilation boundary. With the boundary applied
to both targets they produce identical symbolic token streams and parse trees.
