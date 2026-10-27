# Java requalification

Cross-runtime conformance over 1,244 opaque production files:

| Runtime    | Accepted files | Diagnostics | LL fallback files |
| ---------- | -------------: | ----------: | ----------------: |
| TypeScript |          1,235 |         107 |                15 |
| Java       |          1,211 |         367 |               144 |

1,193 files are identical across all required fields. 51 files differ:

| Changed field                 | Files |
| ----------------------------- | ----: |
| Structural parse-tree SHA-256 |    51 |
| Visible token count           |    51 |
| Hidden token count            |    51 |
| Parser diagnostic count       |    26 |

The published evidence contains only opaque file identities, sizes, hashes, and changed-field names. Source text and diagnostic text remain private.

The paired production campaign measured Java at 45.234 s parser core versus TypeScript at 103.888 s, but speed is not an acceptance criterion when structural conformance fails.

## Threats to validity

- Equal structural hashes exclude token text and source offsets by design.
- Different runtime recovery implementations can produce different diagnostics after the first syntax error; those differences remain disqualifying because consumers observe the resulting tree.
- External declaration/reference qualification remains unavailable.
