import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BaseErrorListener, CharStream, CommonTokenStream, Lexer, Parser, type ParseTree, Token } from 'antlr4ng';
import { prepareConditional } from '../../src/conditional.ts';
import { type FileEntry } from './parse.ts';
import { type GrammarBenchmarkObservation, type GrammarBenchmarkOutput } from './grammarBenchmarkTypes.ts';

/**
 * Paired grammar-state benchmark harness.
 *
 * Mirrors the production TypeScript parse sequence (prepare, lex, SLL, LL
 * fallback) but imports the recognizers from the generated directory named by
 * `LAB_GENERATED_PARSER_DIR`, so the control and the candidate can be measured
 * with the same corpus in the same process shape.
 */

type GeneratedParser = Parser & Readonly<{ sql_script(): ParseTree }>;
type GeneratedParserConstructor = new (input: CommonTokenStream) => GeneratedParser;
type GeneratedLexerConstructor = new (input: CharStream) => Lexer;

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

if (manifestPath === undefined || filesDir === undefined || parserDirectory === undefined) {
	throw new Error('LAB_MANIFEST, LAB_FILES, and LAB_GENERATED_PARSER_DIR are required');
}

const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (typeof manifest !== 'object' || manifest === null || !('files' in manifest) || !Array.isArray(manifest.files)) {
	throw new Error('Manifest must contain a files array');
}

const entries = (manifest as Readonly<{ files: readonly FileEntry[] }>).files;
const selectedIds = process.env['LAB_IDS']?.split(',').map(Number).filter(Number.isInteger);
const selected = selectedIds === undefined ? entries : entries.filter((entry) => selectedIds.includes(entry.id));

if (selected.length === 0) {
	throw new Error('No corpus files selected for the benchmark');
}

const parserModule: unknown = await import(pathToFileURL(path.join(parserDirectory, 'PlSqlParser.ts')).href);
const lexerModule: unknown = await import(pathToFileURL(path.join(parserDirectory, 'PlSqlLexer.ts')).href);
const ParserConstructor = constructorFrom(parserModule, 'PlSqlParser') as GeneratedParserConstructor;
const LexerConstructor = constructorFrom(lexerModule, 'PlSqlLexer') as GeneratedLexerConstructor;

const startedAt = performance.now();
const files = selected.map((entry, index) => {
	const observation = parseFile(entry);
	const completed = index + 1;

	if (completed === 1 || completed % 25 === 0 || completed === selected.length) {
		process.stderr.write(`[${state}] [${String(completed)}/${String(selected.length)}] elapsed ${formatDuration(performance.now() - startedAt)}\n`);
	}

	return observation;
});

const output: GrammarBenchmarkOutput = { state, files };
process.stdout.write(`${JSON.stringify(output)}\n`);

function parseFile(entry: FileEntry): GrammarBenchmarkObservation {
	const started = performance.now();
	const conditionalStarted = performance.now();
	const prepared = prepareConditional(readFileSync(path.join(filesDir ?? '', entry.file), 'utf8'));
	const conditionalMs = performance.now() - conditionalStarted;
	const setupStarted = performance.now();
	const lexer = new LexerConstructor(CharStream.fromString(prepared));
	const lexerErrors = new DiagnosticCollector();
	lexer.removeErrorListeners();
	lexer.addErrorListener(lexerErrors);
	const stream = new CommonTokenStream(lexer);
	let setupMs = performance.now() - setupStarted;
	const lexerStarted = performance.now();
	stream.fill();
	const lexerMs = performance.now() - lexerStarted;
	const tokens = stream.getTokens();
	const visibleTokens = tokens.filter((token) => token.channel === Token.DEFAULT_CHANNEL).length;
	const parserErrors = new DiagnosticCollector();

	const parserFor = (predictionMode: 0 | 1): GeneratedParser => {
		const parserStarted = performance.now();
		const parser = new ParserConstructor(stream);
		setupMs += performance.now() - parserStarted;
		parser.removeErrorListeners();
		parser.addErrorListener(parserErrors);
		parser.interpreter.predictionMode = predictionMode;
		return parser;
	};

	let parser = parserFor(0);
	const sllStarted = performance.now();
	parser.sql_script();
	const sllParseMs = performance.now() - sllStarted;
	let llParseMs = 0;
	let llAttempts = 0;

	if (parserErrors.messages.length > 0) {
		parserErrors.messages.length = 0;
		stream.seek(0);
		parser = parserFor(1);
		const llStarted = performance.now();
		parser.sql_script();
		llParseMs = performance.now() - llStarted;
		llAttempts = 1;
	}

	const totalMs = performance.now() - started;

	return {
		file: entry.path,
		bytes: entry.bytes,
		coreMs: lexerMs + sllParseMs + llParseMs,
		adapterMs: totalMs,
		phases: { conditionalMs, setupMs, lexerMs, sllParseMs, llParseMs, totalMs },
		lexerDiagnostics: lexerErrors.messages.length,
		parseDiagnostics: parserErrors.messages.length,
		tokens: visibleTokens,
		hiddenTokens: tokens.length - visibleTokens,
		prediction: llAttempts > 0 ? 'sll-fallback-ll' : 'sll',
		llAttempts,
		peakRssBytes: process.resourceUsage().maxRSS * 1024,
	};
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
