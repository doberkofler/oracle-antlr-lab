# 009-semantic-conformance

Corpus: private-production-20261027 (private), 1244 files, 20.9 MB.

Gate status: **pass**. A gate fails on any unexplained parse-tree, unit, token, or diagnostic difference.

| Gate                                     | Issue | Experiment                            | Status | Compared | Identical | Intended | Unsupported | Defects | Control diagnostics | Candidate diagnostics | Fallback files |
| ---------------------------------------- | ----: | ------------------------------------- | ------ | -------: | --------: | -------: | ----------: | ------: | ------------------: | --------------------: | -------------: |
| issue-1-general-element-part             |    #1 | 005-general-element-part-optimization | pass   |     1244 |      1244 |        0 |           0 |       0 |                 181 |                   181 |      129 → 129 |
| issue-2-routine-name-and-general-element |    #2 | 006-routine-name-and-general-element  | pass   |     1244 |      1244 |        0 |           0 |       0 |                 181 |                   181 |      129 → 129 |
| issue-3-full-file-ll-fallback            |    #3 | 007-full-file-ll-fallback             | pass   |     1244 |      1135 |      109 |           0 |       0 |                 181 |                   181 |       129 → 20 |
| combined-final                           |    #6 | 009-semantic-conformance              | pass   |     1244 |      1135 |      109 |           0 |       0 |                 181 |                   181 |       129 → 20 |

Parse-tree identity is the strongest available semantic boundary in this laboratory. Declarations, references, and dependencies are not extracted here; external qualification remains required.

Java remains an unmodified control with 486 parser diagnostics on the frozen production corpus. Its speed does not establish semantic viability.
