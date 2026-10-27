# 010-upstream-grammar-prs-migration

Upstream: `antlr/grammars-v4`; control `8714404279b53fb9856ac6162f468667b0b853bb`.

Corpus: private-production-20261027 (private), 1244 files, 20.9 MB. Fixtures: upstream-grammar-prs (public), 11 files.

Corpus differences: none declared; every changed corpus file is a defect.

Gate status: **fail**. Parse structure is compared with a symbolic digest over rule and token names. Wrapper rules are flattened: alter_table_body, alter_table_action, enable_disable_clauses.

| Candidate   | Pull request | Status | Corpus files | Identical | Intended | Unsupported | Defects | Fixtures identical | Fixtures intended | Fixtures unsupported | Fixture defects |
| ----------- | -----------: | ------ | -----------: | --------: | -------: | ----------: | ------: | -----------------: | ----------------: | -------------------: | --------------: |
| pin-e199816 |   cumulative | fail   |         1244 |       799 |        0 |           0 |     445 |                  0 |                 0 |                    0 |               0 |

## Fixture transitions

| State | Fixture | Control | Candidate | Expected | Result |
| ----- | ------- | ------- | --------- | -------- | ------ |

## Grammar states

| State       | Pull request | Ref or merge                             | Adapted lexer | Adapted parser |
| ----------- | -----------: | ---------------------------------------- | ------------- | -------------- |
| control     |            — | 8714404279b53fb9856ac6162f468667b0b853bb | 356626e76e3c  | 622596e33873   |
| pin-e199816 |            — | e199816b3f1a7a49ea1ad84fb6b87c382ea36a33 | b5330652edcb  | fecc2f5b4c37   |

Generated parsers are not committed. Every state is materialized from the pinned upstream ref, adapted by the same reviewed patch set, and generated with the default optimization state. A gate fails on any unexplained parse structure, unit, token, acceptance, or diagnostic difference.
