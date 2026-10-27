import { describe, expect, it } from 'vitest';

import { type FileEntry, parseSource } from '../grammar/typescript/parse.ts';

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

	it('rejects ALTER TABLE without an action', () => {
		expect(parse('ALTER TABLE t;').parseDiagnostics).toBeGreaterThan(0);
	});
});
