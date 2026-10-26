import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The laboratory pins one upstream commit and stores the exact local
 * adaptations as ordered, digest-checked patches. Never edit a downloaded
 * grammar in place: a grammar change is a new patch and a new experiment.
 */
const PIN = {
	commit: 'e199816b3f1a7a49ea1ad84fb6b87c382ea36a33',
	lexer: {
		path: 'sql/plsql/PlSqlLexer.g4',
		sha256: 'fd82384ba3ba2f5a7b070a977cd77a05c01fefbfb52938d35dfaf472a2e6e59e',
	},
	parser: {
		path: 'sql/plsql/PlSqlParser.g4',
		sha256: 'c57ec1819302de05beb08c44792883e159254e361e8627e981d9a3c99a0b4633',
	},
	parserBase: {
		path: 'sql/plsql/Antlr4ng/PlSqlParserBase.ts',
		sha256: '240545ca222036231d7044ce468e2c4ed0d1a0ef6df190cb71a717b47faccfcb',
	},
} as const;

const root = path.resolve(import.meta.dirname, '..');
const grammarRoot = path.join(root, 'grammar');
const upstreamRoot = path.join(grammarRoot, 'upstream');
const adaptedRoot = path.join(grammarRoot, 'adapted');
const baseRoot = path.join(grammarRoot, 'typescript');
const patchDirectory = path.join(grammarRoot, 'patches');

type Patch = Readonly<{ file: string; find: string; replace: string; reason: string }>;

const LEXER_HEADER = `@header {import {PlSqlLexerBase} from "../plSqlLexerBase.js";}

@members {
public isValidAlternativeQuotedString(): boolean {
    const characters = Array.from(this.text);
    const openingDelimiter = characters[2];
    const closingDelimiter = characters.at(-2);
    if (openingDelimiter === undefined || closingDelimiter === undefined || /\\s/u.test(openingDelimiter)) {
        return false;
    }

    switch (openingDelimiter) {
        case '[':
            return closingDelimiter === ']';
        case '{':
            return closingDelimiter === '}';
        case '<':
            return closingDelimiter === '>';
        case '(':
            return closingDelimiter === ')';
        default:
            return closingDelimiter === openingDelimiter;
    }
}
}`;

const UPSTREAM_Q_STRING = readFileSync(path.join(patchDirectory, 'upstream-q-string.txt'), 'utf8')
	.replaceAll(String.raw`\/`, '/')
	.trimEnd();
const ADAPTED_Q_STRING = readFileSync(path.join(patchDirectory, 'adapted-q-string.txt'), 'utf8')
	.replaceAll(String.raw`\/`, '/')
	.trimEnd();

const patches: readonly Patch[] = [
	{
		file: 'PlSqlLexer.g4',
		find: '// Insert here @header for C++ lexer.',
		replace: LEXER_HEADER,
		reason: 'TypeScript lexer base and the alternative-quoted-string predicate.',
	},
	{
		file: 'PlSqlLexer.g4',
		find: UPSTREAM_Q_STRING,
		replace: ADAPTED_Q_STRING,
		reason: 'Upstream Q-quote limitation; see grammars-v4#5029 and #5030.',
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
	const [lexerBytes, parserBytes, parserBaseBytes] = await Promise.all([
		fetchPinned(PIN.lexer.path, PIN.lexer.sha256),
		fetchPinned(PIN.parser.path, PIN.parser.sha256),
		fetchPinned(PIN.parserBase.path, PIN.parserBase.sha256),
	]);

	mkdirSync(upstreamRoot, { recursive: true });
	mkdirSync(adaptedRoot, { recursive: true });
	mkdirSync(baseRoot, { recursive: true });

	writeFileSync(path.join(upstreamRoot, 'PlSqlLexer.g4'), lexerBytes);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParser.g4'), parserBytes);
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
	writeFileSync(path.join(baseRoot, 'plSqlLexerBase.ts'), lexerBaseSource());
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

const lexerBaseSource = (): string => `import {Lexer} from 'antlr4ng';

/**
 * Base for the generated Oracle lexer.
 *
 * The upstream predicate relies on a one-character lookbehind. Keep this
 * implementation byte-for-byte equivalent when changing grammar actions.
 */
export abstract class PlSqlLexerBase extends Lexer {
	public IsNewlineAtPos(pos: number): boolean {
		const la = this.inputStream.LA(pos);
		return la === -1 || String.fromCharCode(la) === '\\n';
	}
}
`;

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
