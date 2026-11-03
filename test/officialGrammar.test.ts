import { describe, expect, it } from 'vitest';

import { type FileEntry, parseSource } from '../grammar/typescript/parse.ts';

const BARE_JOIN_SOURCE = 'SELECT customer.name FROM customer JOIN address ON address.customer_id = customer.id;';

const parse = (source: string): ReturnType<typeof parseSource>['observation'] => {
	const entry: FileEntry = {
		id: 0,
		path: 'official-grammar.sql',
		file: 'official-grammar.sql',
		bytes: Buffer.byteLength(source),
		lines: source.split('\n').length,
		sha256: '0'.repeat(64),
	};

	return parseSource(source, entry).observation;
};

const acceptedFixtures = [
	{
		name: 'tab-separated SQL*Plus commands',
		source: 'REM\ttab-separated remark\nPROMPT\ttab-separated prompt\nSELECT 1 FROM dual;\n/',
	},
	{
		name: 'XMLTABLE RETURNING SEQUENCE BY REF',
		source: "SELECT * FROM XMLTABLE('/x' PASSING xml_col RETURNING SEQUENCE BY REF COLUMNS id VARCHAR2(10) PATH 'id');",
	},
	{
		name: 'SQL*Plus EXECUTE commands',
		source: "EXEC dbms_output.put_line('short');\nEXECUTE :n := 1",
	},
	{
		name: 'DATE, DETECTED, and ENCLOSED identifiers',
		source: `CREATE PACKAGE keyword_identifiers AS
	date VARCHAR2(10);
	detected BOOLEAN;
	enclosed VARCHAR2(10);
END keyword_identifiers;
/`,
	},
	{
		name: 'analytic-view dimension keys',
		source: `CREATE OR REPLACE ANALYTIC VIEW sales_av
USING sales_fact
DIMENSION BY
	(time_attr_dim
		KEY (month_id) REFERENCES DISTINCT (year_id, quarter_id, month_id)
		HIERARCHIES (time_hier DEFAULT))
MEASURES (sales FACT sales)
DEFAULT MEASURE sales;`,
	},
	{
		name: 'ALTER TABLE actions',
		source: 'ALTER TABLE t ADD (c NUMBER);\nALTER TABLE t SHRINK SPACE;\nALTER TABLE t ENABLE TABLE LOCK;',
	},
	{
		name: 'TIME ZONE clauses',
		source: `ALTER DATABASE SET TIME_ZONE = 'UTC';
SELECT JSON_VALUE('{"ts":"2024-01-01T00:00:00"}', '$.ts' RETURNING TIMESTAMP WITH TIME ZONE) FROM dual;`,
	},
	{
		name: 'simple CASE selector lists and dangling predicates',
		source: `BEGIN
	CASE value
		WHEN 1, 2 THEN NULL;
		WHEN > 10 THEN NULL;
	END CASE;
END;
/`,
	},
	{
		name: 'parenthesized subquery set operations',
		source: `SELECT (
	(SELECT 'y' FROM dual)
	UNION
	(SELECT 'n' FROM dual)
) AS yes_no
FROM dual;`,
	},
	{
		name: 'bare JOIN clauses',
		source: BARE_JOIN_SOURCE,
	},
	{
		name: 'COMPRESSION identifiers',
		source: `CREATE PACKAGE keyword_identifier_compression AS
	compression BOOLEAN;
END keyword_identifier_compression;
/`,
	},
	{
		name: 'JSON_SERIALIZE expression input',
		source: `SELECT JSON_SERIALIZE(json_document RETURNING CLOB) FROM json_documents;
SELECT JSON_SERIALIZE(
	CASE WHEN use_fallback = 1 THEN '{}' ELSE json_document END
	RETURNING CLOB PRETTY
) FROM json_documents;`,
	},
	{
		name: 'parenthesized IS JSON modes',
		source: `SELECT * FROM json_documents WHERE json_document IS JSON (STRICT);
SELECT * FROM json_documents WHERE json_document IS NOT JSON (LAX);`,
	},
	{
		name: 'explicitly nullable record fields',
		source: `CREATE PACKAGE record_field_explicit_null AS
	TYPE item_record IS RECORD (value DATE NULL);
END record_field_explicit_null;
/`,
	},
	{
		name: 'delimited record names in INSERT',
		source: `DECLARE
	"record" target_table%ROWTYPE;
BEGIN
	INSERT INTO target_table VALUES "record";
END;
/`,
	},
	{
		name: 'official arbitrary Q-quote delimiters',
		source: "SELECT q'!arbitrary delimiter!' FROM dual;",
	},
] as const;

describe('official upstream grammar', () => {
	it.each(acceptedFixtures)('accepts $name', ({ source }) => {
		const observation = parse(source);

		expect(observation.lexerDiagnostics).toBe(0);
		expect(observation.parseDiagnostics).toBe(0);
	});

	it('parses bare JOIN without full-file LL fallback', () => {
		expect(parse(BARE_JOIN_SOURCE).prediction).toBe('sll');
	});

	it('rejects ALTER TABLE without an action', () => {
		expect(parse('ALTER TABLE t;').parseDiagnostics).toBeGreaterThan(0);
	});
});
