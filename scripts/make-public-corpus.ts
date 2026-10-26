import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildManifest } from '../src/corpus.ts';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, '.work', 'public-source');
const outputRoot = path.join(root, 'corpora', 'public');

rmSync(sourceRoot, { recursive: true, force: true });
mkdirSync(sourceRoot, { recursive: true });

const declaration = (index: number): string => {
	const name = `f_value_${String(index)}`;
	return `\t${name} number := ${String(index)};`;
};

const routine = (index: number): string => `\tfunction routine_${String(index)}(p_value number) return number is
\t\tl_total number := 0;
\tbegin
\t\tfor i in 1 .. p_value loop
\t\t\tl_total := l_total + i;
\t\tend loop;
\t\treturn case when l_total > 0 then l_total else p_value end;
\tend routine_${String(index)};
`;

const body = (index: number, units: number): string => `create or replace package body synthetic_${String(index)} as
${Array.from({ length: units }, (_, unit) => routine(unit)).join('\n')}
\tprocedure run is
\t\tl_result number;
\t\tcursor c_values is select level as value from dual connect by level <= 10;
\tbegin
\t\tfor r in c_values loop
\t\t\tl_result := routine_0(r.value);
\t\tend loop;

\t\tbegin
\t\t\tl_result := l_result + 1;
\t\texception
\t\t\twhen others then
\t\t\t\tl_result := 0;
\t\tend;

\t\tif l_result is not null then
\t\t\tdbms_output.put_line(to_char(l_result));
\t\tend if;
\tend run;
end synthetic_${String(index)};
/
`;

const spec = (index: number): string => `create or replace package synthetic_${String(index)} as
\tfunction routine_0(p_value number) return number;
end synthetic_${String(index)};
/
`;

const sizes = [1, 2, 4, 8, 16, 32, 64];

for (const [index, units] of sizes.entries()) {
	writeFileSync(path.join(sourceRoot, `synthetic_${String(index)}.pks`), spec(index));
	writeFileSync(path.join(sourceRoot, `synthetic_${String(index)}.pkb`), body(index, units));
}

// Include select constructs that exercise lexer and parser edges without
// embedding any external corpus text.
writeFileSync(
	path.join(sourceRoot, 'edge_q_quote.sql'),
	`select q'[bracketed text]' as value from dual
/
select q'{braced text}' as value from dual
/
`,
);
writeFileSync(
	path.join(sourceRoot, 'edge_conditional.pkb'),
	`create or replace package body edge_conditional as
\tprocedure run is
\tbegin
\t\t$if false $then
\t\t\tdbms_output.put_line('disabled');
\t\t$else
\t\t\tdbms_output.put_line('enabled');
\t\t$end
\tend run;
end edge_conditional;
/
`,
);
writeFileSync(
	path.join(sourceRoot, 'edge_nested.pkb'),
	`create or replace package body edge_nested as
\tprocedure run is
\tbegin
\t\tdeclare
\t\t\tl_value number := 1;
\t\tbegin
\t\t\tdeclare
\t\t\t\tl_inner number := 2;
\t\t\tbegin
\t\t\t\tl_value := l_value + l_inner;
\t\t\tend;
\t\tend;
\tend run;
end edge_nested;
/
`,
);

for (let index = 0; index < 31; index += 1) {
	const declarations = Array.from({ length: 10 + index }, (_, position) => declaration(position)).join('\n');
	writeFileSync(
		path.join(sourceRoot, `filler_${String(index).padStart(2, '0')}.sql`),
		`declare
${declarations}
begin
\tnull;
end;
/
`,
	);
}

const manifest = buildManifest({
	id: 'public-synthetic',
	description: 'Deterministically generated Oracle PL/SQL sources for reproducible parser experiments. No production source.',
	sourceRoot,
	outputRoot,
	visibility: 'public',
});

process.stdout.write(`Public corpus: ${String(manifest.files.length)} files in ${path.relative(root, outputRoot)}\n`);
