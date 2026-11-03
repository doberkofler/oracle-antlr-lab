import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The laboratory pins one upstream commit and stores the exact local
 * adaptations as ordered, digest-checked patches. Never edit a downloaded
 * grammar in place: a grammar change is a new patch and a new experiment.
 */
const PIN = {
	commit: 'b96e04db9d54bb313e542cc3e6ee913900a21520',
	lexer: {
		path: 'sql/plsql/PlSqlLexer.g4',
		sha256: 'aaddaa2f9d40e10ab71e83a402499ae893aa7f03497a631e5c12f2c4cd1d2567',
	},
	parser: {
		path: 'sql/plsql/PlSqlParser.g4',
		sha256: '271bd58495208231f0885132270f59a79aa11faffd8a1c5d1504f0c776af5d5c',
	},
	lexerBase: {
		path: 'sql/plsql/Antlr4ng/PlSqlLexerBase.ts',
		sha256: '60463fb2d8e19ff40b77f1428056f74c7d19bb55263451a0f4a84670e227ae91',
	},
	parserBase: {
		path: 'sql/plsql/Antlr4ng/PlSqlParserBase.ts',
		sha256: 'f83c2eab005f3174f2b506c7e553577f96c336fc18e7c456a58c273566c634eb',
	},
} as const;

const root = path.resolve(import.meta.dirname, '..');
const grammarRoot = path.join(root, 'grammar');
const upstreamRoot = path.join(grammarRoot, 'upstream');
const patchedRoot = path.join(grammarRoot, 'patched');
const adaptedRoot = path.join(grammarRoot, 'adapted');
const baseRoot = path.join(grammarRoot, 'typescript');
const patchRoot = path.join(grammarRoot, 'patches');

type Adaptation = Readonly<{ file: string; find: string; replace: string; reason: string }>;
type SourcePatch = Readonly<{
	file: string;
	sha256: string;
	reason: string;
	upstreamPullRequest: string;
}>;

const adaptations: readonly Adaptation[] = [
	{
		file: 'PlSqlLexer.g4',
		find: '// Insert here @header for C++ lexer.',
		replace: '@header {import {PlSqlLexerBase} from "../plSqlLexerBase.js";}',
		reason: 'TypeScript lexer base import.',
	},
	{
		file: 'PlSqlParser.g4',
		find: '// Insert here @header for C++ parser.',
		replace: '@header {import {PlSqlParserBase} from "../plSqlParserBase.js";}',
		reason: 'TypeScript parser base import.',
	},
];

const sourcePatches: readonly SourcePatch[] = [
	{
		file: '5132-atom-subquery-operation-part.patch',
		sha256: 'c213ecde68029033a9b08e7611d2784f0292d3108d7adb348cb24fecb54c0563',
		reason: 'Remove the redundant subquery_operation_part sequence from atom.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5132',
	},
	{
		file: '5153-bare-join-predicate.patch',
		sha256: '02eef45b16e7b63bea7817d518d561cd3437555c908ac968187f219c89337597',
		reason: 'Treat bare JOIN as a join-clause starter in the TypeScript parser base.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5153',
	},
	{
		file: '5154-compression-identifier.patch',
		sha256: '462e5b90546216a4fe544323a3100b57f968f3527447efe5b170486bfa0e9b09',
		reason: 'Allow COMPRESSION as a regular identifier.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5154',
	},
	{
		file: '5155-json-serialize-expression.patch',
		sha256: 'ca99d3b90510a5b730439b4e46125a00e12b3de555f65715be8708a8f2117133',
		reason: 'Accept scalar expression input in JSON_SERIALIZE.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5155',
	},
	{
		file: '5156-parenthesized-is-json-mode.patch',
		sha256: 'edf619c0e4f923c9f0f126689bacff27a4e9127c6a421570e51cd43413d83a91',
		reason: 'Accept parenthesized STRICT and LAX modifiers in IS JSON.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5156',
	},
	{
		file: '5157-record-field-null.patch',
		sha256: '040881e12600afdd61b672a0cff3987ead8e432b0375ca6c30be7b39e9ecac39',
		reason: 'Accept explicit NULL constraints in record fields.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5157',
	},
	{
		file: '5158-delimited-record-insert.patch',
		sha256: 'c3936f33981a420d8bc0a4d272485c1f11e96781201576fe5be487d5aafaf848',
		reason: 'Accept delimited record names in the PL/SQL INSERT extension.',
		upstreamPullRequest: 'https://github.com/antlr/grammars-v4/pull/5158',
	},
];

const fetchPinned = async (sourcePath: string, expectedDigest: string): Promise<Buffer> => {
	const response = await fetch(`https://raw.githubusercontent.com/antlr/grammars-v4/${PIN.commit}/${sourcePath}`);

	if (!response.ok) {
		throw new Error(`Unable to download ${sourcePath}: ${response.status} ${response.statusText}`);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	const actual = createHash('sha256').update(bytes).digest('hex');

	if (actual !== expectedDigest) {
		throw new Error(`${sourcePath} digest mismatch: expected ${expectedDigest}, got ${actual}`);
	}

	return bytes;
};

const applyAdaptation = (source: string, adaptation: Adaptation): string => {
	const first = source.indexOf(adaptation.find);

	if (first < 0 || first !== source.lastIndexOf(adaptation.find)) {
		throw new Error(`Adaptation for ${adaptation.file} must match exactly once: ${adaptation.reason}`);
	}

	return source.replace(adaptation.find, adaptation.replace);
};

const applySourcePatch = (patch: SourcePatch): void => {
	const patchPath = path.join(patchRoot, patch.file);
	const patchBytes = readFileSync(patchPath);
	const actualDigest = createHash('sha256').update(patchBytes).digest('hex');

	if (actualDigest !== patch.sha256) {
		throw new Error(`${patch.file} digest mismatch: expected ${patch.sha256}, got ${actualDigest}`);
	}

	const result = spawnSync('git', ['apply', '--whitespace=nowarn', patchPath], {
		cwd: root,
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		throw new Error(`Unable to apply ${patch.file}: ${result.stderr.trim()}`);
	}
};

const main = async (): Promise<void> => {
	const [lexerBytes, parserBytes, lexerBaseBytes, parserBaseBytes] = await Promise.all([
		fetchPinned(PIN.lexer.path, PIN.lexer.sha256),
		fetchPinned(PIN.parser.path, PIN.parser.sha256),
		fetchPinned(PIN.lexerBase.path, PIN.lexerBase.sha256),
		fetchPinned(PIN.parserBase.path, PIN.parserBase.sha256),
	]);

	mkdirSync(upstreamRoot, { recursive: true });
	mkdirSync(patchedRoot, { recursive: true });
	mkdirSync(adaptedRoot, { recursive: true });
	mkdirSync(baseRoot, { recursive: true });

	writeFileSync(path.join(upstreamRoot, 'PlSqlLexer.g4'), lexerBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParser.g4'), parserBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlLexerBase.ts'), lexerBaseBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParserBase.ts'), parserBaseBytes);
	writeFileSync(path.join(patchedRoot, 'PlSqlParser.g4'), parserBytes);
	writeFileSync(path.join(baseRoot, 'plSqlLexerBase.ts'), lexerBaseSource(lexerBaseBytes.toString('utf8')));
	writeFileSync(path.join(baseRoot, 'plSqlParserBase.ts'), parserBaseSource(parserBaseBytes.toString('utf8')));

	for (const patch of sourcePatches) {
		applySourcePatch(patch);
	}

	let lexer = lexerBytes.toString('utf8');
	let parser = readFileSync(path.join(patchedRoot, 'PlSqlParser.g4'), 'utf8');

	for (const adaptation of adaptations) {
		if (adaptation.file === 'PlSqlLexer.g4') {
			lexer = applyAdaptation(lexer, adaptation);
		} else {
			parser = applyAdaptation(parser, adaptation);
		}
	}

	writeFileSync(path.join(adaptedRoot, 'PlSqlLexer.g4'), lexer);
	writeFileSync(path.join(adaptedRoot, 'PlSqlParser.g4'), parser);

	const patchedParser = readFileSync(path.join(patchedRoot, 'PlSqlParser.g4'));
	const adaptedLexer = readFileSync(path.join(adaptedRoot, 'PlSqlLexer.g4'));
	const adaptedParser = readFileSync(path.join(adaptedRoot, 'PlSqlParser.g4'));
	const adaptedParserBase = readFileSync(path.join(baseRoot, 'plSqlParserBase.ts'));

	const manifest = {
		schemaVersion: 2,
		upstream: PIN,
		adaptations: adaptations.map((adaptation) => ({ file: adaptation.file, reason: adaptation.reason })),
		patches: sourcePatches,
		patched: {
			parserSha256: createHash('sha256').update(patchedParser).digest('hex'),
		},
		adapted: {
			lexerSha256: createHash('sha256').update(adaptedLexer).digest('hex'),
			parserSha256: createHash('sha256').update(adaptedParser).digest('hex'),
			parserBaseSha256: createHash('sha256').update(adaptedParserBase).digest('hex'),
		},
	};
	writeFileSync(path.join(grammarRoot, 'pin.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

	process.stdout.write(
		`Pinned ${PIN.commit}\nApplied ${String(sourcePatches.length)} source patches\nAdapted lexer ${manifest.adapted.lexerSha256.slice(0, 12)}\nAdapted parser ${manifest.adapted.parserSha256.slice(0, 12)}\n`,
	);
};

const lexerBaseSource = (upstream: string): string => {
	const adapted = upstream
		.replace('import { CommonToken, Lexer, CharStream, Token, CommonTokenStream } from "antlr4ng";', "import {Lexer} from 'antlr4ng';")
		.replace('  IsNewlineAtPos(pos: number): boolean {', '  public IsNewlineAtPos(pos: number): boolean {')
		.replace('  IsQQuoteDelimiter(): boolean {', '  public IsQQuoteDelimiter(): boolean {')
		.replaceAll(' == ', ' === ');

	if (adapted === upstream || !adapted.includes('public IsQQuoteDelimiter')) {
		throw new Error('Lexer base adaptation did not match');
	}

	return adapted;
};

const parserBaseSource = (upstream: string): string => {
	const withLexerImport = upstream.replace("import { PlSqlLexer } from './PlSqlLexer.js';", "import {PlSqlLexer} from './generated/PlSqlLexer.ts';");

	if (withLexerImport === upstream) {
		throw new Error('Parser base lexer import patch did not match');
	}

	return `${withLexerImport
		.replace('  reset(): void {', '  override reset(): void {')
		.replace(
			"import { Parser, TokenStream, CommonTokenStream, Token } from 'antlr4ng';",
			"import {Parser, type TokenStream, CommonTokenStream, Token} from 'antlr4ng';",
		)
		.trimEnd()}\n`;
};

await main();
