import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The laboratory pins one upstream commit and stores the exact local
 * adaptations as ordered, digest-checked patches. Never edit a downloaded
 * grammar in place: a grammar change is a new patch and a new experiment.
 */
const PIN = {
	commit: '5be087cfe78c4eb78374a1c81324848876661f9a',
	lexer: {
		path: 'sql/plsql/PlSqlLexer.g4',
		sha256: 'aaddaa2f9d40e10ab71e83a402499ae893aa7f03497a631e5c12f2c4cd1d2567',
	},
	parser: {
		path: 'sql/plsql/PlSqlParser.g4',
		sha256: '2437508c3e8126d0a09c4cc98fc12741a9d25350b4626350805afdcb74956827',
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
const adaptedRoot = path.join(grammarRoot, 'adapted');
const baseRoot = path.join(grammarRoot, 'typescript');
type Patch = Readonly<{ file: string; find: string; replace: string; reason: string }>;

const patches: readonly Patch[] = [
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

const applyPatch = (source: string, patch: Patch): string => {
	const first = source.indexOf(patch.find);

	if (first < 0 || first !== source.lastIndexOf(patch.find)) {
		throw new Error(`Patch for ${patch.file} must match exactly once: ${patch.reason}`);
	}

	return source.replace(patch.find, patch.replace);
};

const main = async (): Promise<void> => {
	const [lexerBytes, parserBytes, lexerBaseBytes, parserBaseBytes] = await Promise.all([
		fetchPinned(PIN.lexer.path, PIN.lexer.sha256),
		fetchPinned(PIN.parser.path, PIN.parser.sha256),
		fetchPinned(PIN.lexerBase.path, PIN.lexerBase.sha256),
		fetchPinned(PIN.parserBase.path, PIN.parserBase.sha256),
	]);

	mkdirSync(upstreamRoot, { recursive: true });
	mkdirSync(adaptedRoot, { recursive: true });
	mkdirSync(baseRoot, { recursive: true });

	writeFileSync(path.join(upstreamRoot, 'PlSqlLexer.g4'), lexerBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParser.g4'), parserBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlLexerBase.ts'), lexerBaseBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParserBase.ts'), parserBaseBytes);

	let lexer = lexerBytes.toString('utf8');
	let parser = parserBytes.toString('utf8');

	for (const patch of patches) {
		if (patch.file === 'PlSqlLexer.g4') {
			lexer = applyPatch(lexer, patch);
		} else {
			parser = applyPatch(parser, patch);
		}
	}

	writeFileSync(path.join(adaptedRoot, 'PlSqlLexer.g4'), lexer);
	writeFileSync(path.join(adaptedRoot, 'PlSqlParser.g4'), parser);
	writeFileSync(path.join(baseRoot, 'plSqlLexerBase.ts'), lexerBaseSource(lexerBaseBytes.toString('utf8')));
	writeFileSync(path.join(baseRoot, 'plSqlParserBase.ts'), parserBaseSource(parserBaseBytes.toString('utf8')));

	const manifest = {
		schemaVersion: 1,
		upstream: PIN,
		patches: patches.map((patch) => ({ file: patch.file, reason: patch.reason })),
		adapted: {
			lexerSha256: createHash('sha256').update(lexer).digest('hex'),
			parserSha256: createHash('sha256').update(parser).digest('hex'),
		},
	};
	writeFileSync(path.join(grammarRoot, 'pin.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

	process.stdout.write(
		`Pinned ${PIN.commit}\nAdapted lexer ${manifest.adapted.lexerSha256.slice(0, 12)}\nAdapted parser ${manifest.adapted.parserSha256.slice(0, 12)}\n`,
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
