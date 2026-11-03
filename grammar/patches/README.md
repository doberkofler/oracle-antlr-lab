# PL/SQL patch series

`scripts/download-grammar.ts` applies these patches in the order recorded in
`grammar/pin.json` after verifying each SHA-256 digest. They are temporary local
copies of changes submitted to `antlr/grammars-v4`. Target-neutral grammar
changes materialize under `grammar/patched/`; TypeScript-only adaptation follows
under `grammar/adapted/`:

| Patch                                     | Upstream PR                                             | Target               |
| ----------------------------------------- | ------------------------------------------------------- | -------------------- |
| `5132-atom-subquery-operation-part.patch` | [#5132](https://github.com/antlr/grammars-v4/pull/5132) | Parser grammar       |
| `5153-bare-join-predicate.patch`          | [#5153](https://github.com/antlr/grammars-v4/pull/5153) | Antlr4ng parser base |
| `5154-compression-identifier.patch`       | [#5154](https://github.com/antlr/grammars-v4/pull/5154) | Parser grammar       |
| `5155-json-serialize-expression.patch`    | [#5155](https://github.com/antlr/grammars-v4/pull/5155) | Parser grammar       |
| `5156-parenthesized-is-json-mode.patch`   | [#5156](https://github.com/antlr/grammars-v4/pull/5156) | Parser grammar       |
| `5157-record-field-null.patch`            | [#5157](https://github.com/antlr/grammars-v4/pull/5157) | Parser grammar       |
| `5158-delimited-record-insert.patch`      | [#5158](https://github.com/antlr/grammars-v4/pull/5158) | Parser grammar       |

The Java equivalent of #5153 is checked into `java/src/PlSqlParserBase.java`.
Remove each local patch after advancing the clean upstream pin past its merged
commit.
