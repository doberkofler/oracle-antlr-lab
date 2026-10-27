import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adaptGrammar, GRAMMAR_PATCHES, type GrammarSources, PIN } from './grammarAdaptation.ts';

/**
 * The laboratory pins one upstream commit and stores the exact local
 * adaptations as ordered, digest-checked patches. Never edit a downloaded
 * grammar in place: a grammar change is a new patch and a new experiment.
 */
const root = path.resolve(import.meta.dirname, '..');
const grammarRoot = path.join(root, 'grammar');
const upstreamRoot = path.join(grammarRoot, 'upstream');
const adaptedRoot = path.join(grammarRoot, 'adapted');
const baseRoot = path.join(grammarRoot, 'typescript');

const fetchPinned = async (sourcePath: string, expectedDigest: string): Promise<string> => {
	const response = await fetch(`https://raw.githubusercontent.com/antlr/grammars-v4/${PIN.commit}/${sourcePath}`);

	if (!response.ok) {
		throw new Error(`Unable to download ${sourcePath}: ${response.status} ${response.statusText}`);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	const actual = createHash('sha256').update(bytes).digest('hex');

	if (actual !== expectedDigest) {
		throw new Error(`${sourcePath} digest mismatch: expected ${expectedDigest}, got ${actual}`);
	}

	return bytes.toString('utf8');
};

const main = async (): Promise<void> => {
	const [lexer, parser, parserBase] = await Promise.all([
		fetchPinned(PIN.lexer.path, PIN.lexer.sha256),
		fetchPinned(PIN.parser.path, PIN.parser.sha256),
		fetchPinned(PIN.parserBase.path, PIN.parserBase.sha256),
	]);
	const sources: GrammarSources = { lexer, parser, parserBase };

	mkdirSync(upstreamRoot, { recursive: true });
	mkdirSync(adaptedRoot, { recursive: true });
	mkdirSync(baseRoot, { recursive: true });

	writeFileSync(path.join(upstreamRoot, 'PlSqlLexer.g4'), lexer);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParser.g4'), parser);
	writeFileSync(path.join(upstreamRoot, 'PlSqlParserBase.ts'), parserBase);

	const adapted = adaptGrammar(sources);

	writeFileSync(path.join(adaptedRoot, 'PlSqlLexer.g4'), adapted.lexer);
	writeFileSync(path.join(adaptedRoot, 'PlSqlParser.g4'), adapted.parser);
	writeFileSync(path.join(baseRoot, 'plSqlLexerBase.ts'), adapted.lexerBase);
	writeFileSync(path.join(baseRoot, 'plSqlParserBase.ts'), adapted.parserBase);

	const manifest = {
		schemaVersion: 1,
		upstream: PIN,
		patches: GRAMMAR_PATCHES,
		adapted: {
			lexerSha256: createHash('sha256').update(adapted.lexer).digest('hex'),
			parserSha256: createHash('sha256').update(adapted.parser).digest('hex'),
		},
	};
	writeFileSync(path.join(grammarRoot, 'pin.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

	process.stdout.write(
		`Pinned ${PIN.commit}\nAdapted lexer ${manifest.adapted.lexerSha256.slice(0, 12)}\nAdapted parser ${manifest.adapted.parserSha256.slice(0, 12)}\n`,
	);
};

await main();
