# 010-upstream-grammar-prs

Upstream: `antlr/grammars-v4`; control `8714404279b53fb9856ac6162f468667b0b853bb`.

Corpus: private-production-20261027 (private), 1244 files, 20.9 MB. Fixtures: upstream-grammar-prs (public), 11 files.

Corpus differences: declared in `experiments/010-upstream-grammar-prs/corpus-policy.json` (SHA-256 04551ddb5ad5dc25b8e0ba81fc211ec86a60881abd622c0bd608554682b2785a).

Gate status: **pass**. Parse structure is compared with a symbolic digest over rule and token names. Wrapper rules are flattened: alter_table_body, alter_table_action, enable_disable_clauses.

| Candidate | Pull request | Status | Corpus files | Identical | Intended | Unsupported | Defects | Fixtures identical | Fixtures intended | Fixtures unsupported | Fixture defects |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pr-5127 | #5127 | pass | 1244 | 1244 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| pr-5128 | #5128 | pass | 1244 | 1243 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| pr-5129 | #5129 | pass | 1244 | 1241 | 0 | 3 | 0 | 0 | 1 | 0 | 0 |
| pr-5131 | #5131 | pass | 1244 | 1239 | 3 | 2 | 0 | 0 | 3 | 0 | 0 |
| pr-5132 | #5132 | pass | 1244 | 1242 | 2 | 0 | 0 | 1 | 0 | 0 | 0 |
| pr-5133 | #5133 | pass | 1244 | 1244 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| pr-5134 | #5134 | pass | 1244 | 1244 | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| pr-5135 | #5135 | pass | 1244 | 1244 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| cumulative | cumulative | pass | 1244 | 1236 | 6 | 2 | 0 | 2 | 9 | 0 | 0 |

## Fixture transitions

| State | Fixture | Control | Candidate | Expected | Result |
| --- | --- | --- | --- | --- | --- |
| pr-5127 | 5127-sqlplus_remark_prompt_whitespace.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5128 | 5128-xmltable_returning_sequence_by_ref.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5129 | 5129-sqlplus_exec_command.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5131 | 5131-keywordasidentifier06.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5131 | 5131-keywordasidentifier07.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5131 | 5131-keywordasidentifier08.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5132 | 5132-atom_subquery_operation.sql | accepted | accepted | accepted -> accepted | pass |
| pr-5133 | 5133-create_analytic_view_dim_key.sql | rejected | accepted | rejected -> accepted | pass |
| pr-5134 | 5134-alter_table_empty.sql | accepted | rejected | accepted -> rejected | pass |
| pr-5134 | 5134-alter_table_actions.sql | accepted | accepted | accepted -> accepted | pass |
| pr-5135 | 5135-time_zone.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5127-sqlplus_remark_prompt_whitespace.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5128-xmltable_returning_sequence_by_ref.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5129-sqlplus_exec_command.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5131-keywordasidentifier06.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5131-keywordasidentifier07.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5131-keywordasidentifier08.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5133-create_analytic_view_dim_key.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5134-alter_table_empty.sql | accepted | rejected | accepted -> rejected | pass |
| cumulative | 5135-time_zone.sql | rejected | accepted | rejected -> accepted | pass |
| cumulative | 5132-atom_subquery_operation.sql | accepted | accepted | accepted -> accepted | pass |
| cumulative | 5134-alter_table_actions.sql | accepted | accepted | accepted -> accepted | pass |

## Grammar states

| State | Pull request | Ref or merge | Adapted lexer | Adapted parser |
| --- | ---: | --- | --- | --- |
| control | — | 8714404279b53fb9856ac6162f468667b0b853bb | 356626e76e3c | 622596e33873 |
| pr-5127 | #5127 | 4828ebc978916b24f4ee081f25d5c840e751ebe7 | b2430d2297a3 | 622596e33873 |
| pr-5128 | #5128 | 0146ee3f3ee1b74ef1b2783d909d4424106db156 | 356626e76e3c | a84fe583c17b |
| pr-5129 | #5129 | 4c56477163871fb9ba156ddd1b85896d1255d29d | df3e3022aa1b | 101c0fe767e3 |
| pr-5131 | #5131 | 9ca852617c209c9e6f36cb5c938a6aed7a5100b1 | 356626e76e3c | 2856612ea877 |
| pr-5132 | #5132 | f5cb57f80137f474a9c59a393cc0afef64bb239c | 356626e76e3c | c01e5762dc89 |
| pr-5133 | #5133 | 4cbc15e8004f1cadd5904a93dfdf430c0c87d1e8 | 356626e76e3c | 7c569968fd59 |
| pr-5134 | #5134 | d7ada8a36e68a7b1c4b1e0bad9e1633c7637880c | 356626e76e3c | 6ba45f9aa6d7 |
| pr-5135 | #5135 | a7a3f9a8a9895218889e165ab9e1c0c411c5f694 | 356626e76e3c | b7fd9351c9ad |
| cumulative | — | pr-5127 + pr-5128 + pr-5129 + pr-5131 + pr-5132 + pr-5133 + pr-5134 + pr-5135 | fca301ca2bad | fc5d7248dda3 |

Generated parsers are not committed. Every state is materialized from the pinned upstream ref, adapted by the same reviewed patch set, and generated with the default optimization state. A gate fails on any unexplained parse structure, unit, token, acceptance, or diagnostic difference.
