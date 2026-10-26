# Corpus Format

A corpus is a directory containing `manifest.json` and `files/`.

```text
corpus/
  manifest.json
  files/
    PACKAGES/example.pkb
    procedures/example.prc
```

## Manifest

```json
{
	"id": "public-synthetic",
	"description": "Deterministically generated Oracle PL/SQL sources.",
	"visibility": "public",
	"root": "/absolute/output/directory",
	"sourceFiles": 48,
	"sourceBytes": 123456,
	"selection": "Size quantiles over 48 files; 48 selected",
	"files": [
		{
			"id": 0,
			"path": "example.pkb",
			"file": "example.pkb",
			"bytes": 1234,
			"lines": 56,
			"sha256": "..."
		}
	]
}
```

`path` is the stable source identity used in reports. `file` is the relative
path under `files/`. They are identical. Private corpus generation replaces the
original relative path with an opaque sequential identity while retaining the
extension required by corpus selection.

`root` is informational. Consumers locate content relative to the manifest.

## Selection

`pnpm corpus:select` scans a source root recursively for Oracle source
extensions and selects a deterministic byte-size quantile sample. The full
manifest reports the source population size; only selected files are copied.

The sample is not a semantic stratification. A production decision must use
either the full manifest or a construct-stratified sample that is declared in
the experiment.

`pnpm benchmark:production --selection full|q4|tail` selects files from a
manifest without rewriting it. Q4 is the largest byte-size quartile. Tail is the
highest median TypeScript parser-core set from an audited ranking report. The
campaign writes `selection.json` with the mode, criteria, source artifact digest,
population counts, selected byte range, opaque identities, digests, and
selection fingerprint. The fingerprint is the comparison identity; a control and
candidate must share it.

## Privacy

Private corpora must not be committed. A private report may contain:

- corpus id and selection method;
- file count, byte count, and digests;
- per-file byte sizes and timings;
- opaque file identifiers (mandatory for generated private manifests).

A private report must not contain:

- source text;
- absolute paths outside the corpus root;
- credentials;
- object names that identify the owner.

Use `--id` and `--visibility private` when building a private corpus. Review a
report before sharing it outside the source owner.
