import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BaseErrorListener, CharStream, CommonTokenStream, Lexer, Parser, ParserRuleContext, type ParseTree, Token } from 'antlr4ng';
import { prepareConditional } from '../../src/conditional.ts';
import { type ConformanceObservation, type ConformancePrediction } from '../../src/conformance.ts';
import { type FileEntry } from './parse.ts';
import { treeSha256, treeSha256Symbolic } from './treeDigest.ts';

type Manifest = Readonly<{ files: readonly FileEntry[] }>;

type GeneratedParser = Parser &
	Readonly<{
		sql_script(): ParseTree;
		ruleNames: string[];
		symbolicNames: (string | null)[];
		literalNames: (string | null)[];
	}>;
type GeneratedParserConstructor = new (input: CommonTokenStream) => GeneratedParser;
type GeneratedLexerConstructor = new (input: CharStream) => Lexer;

/**
 * Conformance observation plus the name-stable digests used when the control
 * and the candidate are generated from different grammar revisions.
 */
type GrammarObservation = ConformanceObservation &
	Readonly<{
		symbolicTreeSha256: string;
		normalizedTreeSha256: string;
	}>;

/** Collects diagnostic messages without writing them to stderr. */
class DiagnosticCollector extends BaseErrorListener {
	readonly messages: string[] = [];

	public override syntaxError(
		_recognizer: Parameters<BaseErrorListener['syntaxError']>[0],
		_offendingSymbol: Parameters<BaseErrorListener['syntaxError']>[1],
		line: Parameters<BaseErrorListener['syntaxError']>[2],
		column: Parameters<BaseErrorListener['syntaxError']>[3],
		message: Parameters<BaseErrorListener['syntaxError']>[4],
	): void {
		this.messages.push(`${String(line)}:${String(column)} ${message}`);
	}
}

const manifestPath = process.env['LAB_MANIFEST'];
const filesDir = process.env['LAB_FILES'];
const parserDirectory = process.env['LAB_GENERATED_PARSER_DIR'];
const state = process.env['LAB_STATE'] ?? 'unknown';
const ignoredRules =
	process.env['LAB_IGNORE_RULES']
		?.split(',')
		.map((rule) => rule.trim())
		.filter((rule) => rule.length > 0) ?? [];

if (manifestPath === undefined || filesDir === undefined || parserDirectory === undefined) {
	throw new Error('LAB_MANIFEST, LAB_FILES, and LAB_GENERATED_PARSER_DIR are required');
}

const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (typeof manifest !== 'object' || manifest === null || !('files' in manifest) || !Array.isArray(manifest.files)) {
	throw new Error('Manifest must contain a files array');
}
const entries = (manifest as Manifest).files;
const selectedIds = process.env['LAB_IDS']?.split(',').map(Number).filter(Number.isInteger);
const selected = selectedIds === undefined ? entries : entries.filter((entry) => selectedIds.includes(entry.id));

if (selected.length === 0) {
	throw new Error('No corpus files selected for conformance');
}

const parserModule: unknown = await import(pathToFileURL(path.join(parserDirectory, 'PlSqlParser.ts')).href);
const lexerModule: unknown = await import(pathToFileURL(path.join(parserDirectory, 'PlSqlLexer.ts')).href);
const ParserConstructor = constructorFrom(parserModule, 'PlSqlParser') as GeneratedParserConstructor;
const LexerConstructor = constructorFrom(lexerModule, 'PlSqlLexer') as GeneratedLexerConstructor;

const startedAt = performance.now();
const files = selected.map((entry, index) => {
	const observation = parseFile(entry);
	const completed = index + 1;

	if (completed === 1 || completed % 10 === 0 || completed === selected.length) {
		process.stderr.write(`[${state}] [${String(completed)}/${String(selected.length)}] elapsed ${formatDuration(performance.now() - startedAt)}\n`);
	}

	return observation;
});

process.stdout.write(`${JSON.stringify({ state, files })}\n`);

function parseFile(entry: FileEntry): GrammarObservation {
	const source = prepareConditional(readFileSync(path.join(filesDir ?? '', entry.file), 'utf8'));
	const lexer = new LexerConstructor(CharStream.fromString(source));
	const lexerErrors = new DiagnosticCollector();
	lexer.removeErrorListeners();
	lexer.addErrorListener(lexerErrors);
	const stream = new CommonTokenStream(lexer);
	stream.fill();
	const tokens = stream.getTokens();
	const visibleTokens = tokens.filter((token) => token.channel === Token.DEFAULT_CHANNEL).length;

	const parse = (predictionMode: 0 | 1) => {
		const parser = new ParserConstructor(stream);
		const parserErrors = new DiagnosticCollector();
		parser.removeErrorListeners();
		parser.addErrorListener(parserErrors);
		parser.interpreter.predictionMode = predictionMode;
		const tree = parser.sql_script();

		return { parser, errors: parserErrors, tree };
	};

	let parsed = parse(0);
	let prediction: ConformancePrediction = 'sll';
	let llAttempts = 0;

	if (parsed.errors.messages.length > 0) {
		stream.seek(0);
		parsed = parse(1);
		prediction = 'sll-fallback-ll';
		llAttempts = 1;
	}

	const unitIndex = parsed.parser.ruleNames.indexOf('script_unit');

	if (unitIndex < 0) {
		throw new Error('Generated parser has no script_unit rule');
	}

	const unitCount = Array.from({ length: parsed.tree.getChildCount() }, (_, index) => parsed.tree.getChild(index)).filter(
		(child) => child instanceof ParserRuleContext && child.ruleIndex === unitIndex,
	).length;
	const accepted = lexerErrors.messages.length === 0 && parsed.errors.messages.length === 0;
	const vocabulary = {
		ruleNames: parsed.parser.ruleNames,
		symbolicNames: parsed.parser.symbolicNames,
		literalNames: parsed.parser.literalNames,
	};
	const symbolicTreeSha256 = treeSha256Symbolic(parsed.tree, vocabulary);
	const normalizedTreeSha256 = ignoredRules.length === 0 ? symbolicTreeSha256 : treeSha256Symbolic(parsed.tree, vocabulary, { ignoredRules });

	return {
		file: entry.path,
		bytes: entry.bytes,
		sha256: entry.sha256,
		parseTreeSha256: treeSha256(parsed.tree),
		symbolicTreeSha256,
		normalizedTreeSha256,
		unitCount,
		accepted,
		lexerDiagnostics: lexerErrors.messages.length,
		parseDiagnostics: parsed.errors.messages.length,
		diagnosticsSha256: diagnosticsSha256(lexerErrors.messages, parsed.errors.messages),
		tokens: visibleTokens,
		hiddenTokens: tokens.length - visibleTokens,
		prediction,
		sllAttempts: 1,
		llAttempts,
	};
}

function diagnosticsSha256(lexerMessages: readonly string[], parserMessages: readonly string[]): string {
	return createHash('sha256').update(JSON.stringify({ lexerMessages, parserMessages })).digest('hex');
}

function constructorFrom(module: unknown, name: string): unknown {
	if (typeof module !== 'object' || module === null) {
		throw new Error(`Generated module does not export ${name}`);
	}

	const candidate = Reflect.get(module, name);

	if (typeof candidate !== 'function') {
		throw new Error(`Generated module export ${name} is not a constructor`);
	}

	return candidate;
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
