# Java Target Harness

The Java adapter builds an official ANTLR target in Docker.

```bash
docker build -f java/Dockerfile -t oracle-antlr-lab-java:0.1.0 .
```

The build uses the pinned upstream grammar in `grammar/upstream/` and the
upstream Java base classes. It does not apply the TypeScript-specific patches.

The adapter starts one container per cold or warm stage. Its pass mode accepts
all selected files in one JVM and constructs a parser per file, so it is a
process-level pass, not a shared-DFA measurement.

The Java adapter is optional. `pnpm benchmark` selects TypeScript only unless
`--adapters typescript,java` is passed and Docker is available.
