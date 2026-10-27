import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readGrammarStates, stateByKey } from './grammarStateSource.ts';

/**
 * Reduced fixtures imported from the open upstream grammar pull requests.
 *
 * Upstream example files are copied byte-for-byte from the pull-request head.
 * The two local additions cover a pull request without an upstream example
 * (#5132) and the negative `ALTER TABLE` case declared by #5134.
 */
const LOCAL_FIXTURES: Readonly<Record<string, string>> = {
	'5132-atom_subquery_operation.sql': `-- A parenthesised subquery with a set operation must keep parsing after
-- subquery_operation_part is removed from atom.
SELECT * FROM (SELECT 1 FROM dual UNION ALL SELECT 2 FROM dual) q;

SELECT * FROM ((SELECT 1 FROM dual) UNION ALL (SELECT 2 FROM dual)) q;

SELECT (SELECT 1 FROM dual) + 1 FROM dual;
`,
	'5134-alter_table_empty.sql': `-- An ALTER TABLE with no action is not valid Oracle SQL.
ALTER TABLE t;
`,
	'5134-alter_table_actions.sql': `ALTER TABLE t ADD (c NUMBER);

ALTER TABLE t SHRINK SPACE;

ALTER TABLE t ENABLE TABLE LOCK;

ALTER TABLE t DISABLE ALL TRIGGERS;
`,
};

const UPSTREAM_FIXTURES: readonly Readonly<{ pullRequest: number; state: string; file: string }>[] = [
	{ pullRequest: 5127, state: 'pr-5127', file: 'sqlplus_remark_prompt_whitespace.sql' },
	{ pullRequest: 5128, state: 'pr-5128', file: 'xmltable_returning_sequence_by_ref.sql' },
	{ pullRequest: 5129, state: 'pr-5129', file: 'sqlplus_exec_command.sql' },
	{ pullRequest: 5131, state: 'pr-5131', file: 'keywordasidentifier06.sql' },
	{ pullRequest: 5131, state: 'pr-5131', file: 'keywordasidentifier07.sql' },
	{ pullRequest: 5131, state: 'pr-5131', file: 'keywordasidentifier08.sql' },
	{ pullRequest: 5133, state: 'pr-5133', file: 'create_analytic_view_dim_key.sql' },
	{ pullRequest: 5135, state: 'pr-5135', file: 'time_zone.sql' },
];

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'corpora', 'upstream-prs');
const filesDirectory = path.join(output, 'files');
const manifest = readGrammarStates(root);

rmSync(filesDirectory, { recursive: true, force: true });
mkdirSync(filesDirectory, { recursive: true });

const written: Readonly<{
	file: string;
	sources: readonly Readonly<{ pullRequest?: number; state?: string; path?: string; local?: string }>[];
}>[] = [];

for (const fixture of UPSTREAM_FIXTURES) {
	const state = stateByKey(manifest, fixture.state);

	if (state.ref === undefined) {
		throw new Error(`Fixture state ${fixture.state} has no ref`);
	}

	const source = `https://raw.githubusercontent.com/${manifest.upstream}/${state.ref}/sql/plsql/examples/${fixture.file}`;
	const response = await fetch(source);

	if (!response.ok) {
		throw new Error(`Unable to download ${source}: ${String(response.status)} ${response.statusText}`);
	}

	const file = `${String(fixture.pullRequest)}-${fixture.file}`;
	writeFileSync(path.join(filesDirectory, file), Buffer.from(await response.arrayBuffer()));
	written.push({ file, sources: [{ pullRequest: fixture.pullRequest, state: fixture.state, path: `sql/plsql/examples/${fixture.file}` }] });
}

for (const [file, source] of Object.entries(LOCAL_FIXTURES)) {
	writeFileSync(path.join(filesDirectory, file), source);
	written.push({ file, sources: [{ local: 'Authored in this repository for the experiment.' }] });
}

const entries = written.map((entry, index) => {
	const source = readFileSync(path.join(filesDirectory, entry.file));
	return {
		id: index,
		path: entry.file,
		file: entry.file,
		bytes: source.byteLength,
		lines: source.toString('utf8').split('\n').length,
		sha256: createHash('sha256').update(source).digest('hex'),
	};
});

const corpus = {
	id: 'upstream-grammar-prs',
	description:
		'Reduced PL/SQL fixtures imported from the open grammars-v4 pull requests tracked by issue #13, plus two local fixture groups for the changes without an upstream example.',
	visibility: 'public',
	root: 'files',
	sourceFiles: entries.length,
	sourceBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
	selection: `All ${String(entries.length)} reduced fixtures`,
	files: entries,
	sources: written,
};

writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(corpus, null, '\t')}\n`);
process.stdout.write(`Wrote ${String(entries.length)} fixtures to ${path.relative(root, output)}.\n`);
