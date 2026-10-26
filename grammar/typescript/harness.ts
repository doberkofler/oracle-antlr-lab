import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BaseErrorListener, CharStream, CommonTokenStream, Token } from 'antlr4ng';
import { prepareConditional } from '../../src/conditional.ts';
import { PlSqlLexer } from './generated/PlSqlLexer.ts';
import { PlSqlParser } from './generated/PlSqlParser.ts';

type FileEntry = Readonly<{ id: number; path: string; file: string; bytes: number; lines: number; sha256: string }>;
type Manifest = Readonly<{ files: readonly FileEntry[] }>;

type PhaseTimings = {
	conditionalMs: number;
	setupMs: number;
	lexerMs: number;
	sllParseMs: number;
	llParseMs: number;
	totalMs: number;
};

type Observation = {
	file: string;
	coreMs: number;
	adapterMs: number;
	phases: PhaseTimings;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	tokens: number;
	hiddenTokens: number;
	prediction: 'sll' | 'sll-fallback-ll' | 'unknown';
	sllAttempts: number;
	llAttempts: number;
	peakRssBytes: number;
};

const manifestPath = process.env['LAB_MANIFEST'];
const filesDir = process.env['LAB_FILES'];
const stage = process.env['LAB_STAGE'] ?? 'pass';
const index = process.env['LAB_INDEX'] === undefined ? undefined : Number(process.env['LAB_INDEX']);
const iterations = Number(process.env['LAB_ITERATIONS'] ?? '5');
const warmups = Number(process.env['LAB_WARMUPS'] ?? '1');

if (manifestPath === undefined || filesDir === undefined) {
	throw new Error('LAB_MANIFEST and LAB_FILES are required');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const selectedIds = process.env['LAB_IDS']?.split(',').map(Number).filter(Number.isInteger);
const selected =
	index === undefined
		? selectedIds === undefined
			? manifest.files
			: manifest.files.filter((file) => selectedIds.includes(file.id))
		: manifest.files.filter((file) => file.id === index);

if (selected.length === 0) {
	throw new Error(`No corpus file at index ${String(index)}`);
}

class ErrorCollector extends BaseErrorListener {
	readonly #messages: string[] = [];

	public override syntaxError(
		_recognizer: Parameters<BaseErrorListener['syntaxError']>[0],
		_offendingSymbol: Parameters<BaseErrorListener['syntaxError']>[1],
		line: Parameters<BaseErrorListener['syntaxError']>[2],
		column: Parameters<BaseErrorListener['syntaxError']>[3],
		message: Parameters<BaseErrorListener['syntaxError']>[4],
	): void {
		this.#messages.push(`${String(line)}:${String(column)} ${message}`);
	}

	public get count(): number {
		return this.#messages.length;
	}

	public clear(): void {
		this.#messages.length = 0;
	}
}

const parse = (source: string, entry: FileEntry): Observation => {
	const startedAt = performance.now();
	const conditionalStarted = performance.now();
	const prepared = prepareConditional(source);
	const conditionalMs = performance.now() - conditionalStarted;
	const setupStarted = performance.now();
	const lexer = new PlSqlLexer(CharStream.fromString(prepared));
	const lexerErrors = new ErrorCollector();
	lexer.removeErrorListeners();
	lexer.addErrorListener(lexerErrors);
	const stream = new CommonTokenStream(lexer);
	let setupMs = performance.now() - setupStarted;
	const lexerStarted = performance.now();
	stream.fill();
	const lexerMs = performance.now() - lexerStarted;
	const tokens = stream.getTokens();
	const visibleTokens = tokens.filter((token) => token.channel === Token.DEFAULT_CHANNEL).length;

	const parserFor = (mode: 'sll' | 'll'): PlSqlParser => {
		const parserStarted = performance.now();
		const parser = new PlSqlParser(stream);
		setupMs += performance.now() - parserStarted;
		const interpreter = parser.interpreter;

		if (interpreter === null) {
			throw new Error('Parser interpreter is unavailable');
		}

		parser.removeErrorListeners();
		parser.addErrorListener(parserErrors);
		interpreter.predictionMode = mode === 'sll' ? 0 : 1;
		return parser;
	};

	const parserErrors = new ErrorCollector();
	let parser = parserFor('sll');
	const sllStarted = performance.now();
	parser.sql_script();
	const sllParseMs = performance.now() - sllStarted;
	let llParseMs = 0;
	let llAttempts = 0;

	if (parserErrors.count > 0) {
		parserErrors.clear();
		stream.seek(0);
		parser = parserFor('ll');
		const llStarted = performance.now();
		parser.sql_script();
		llParseMs = performance.now() - llStarted;
		llAttempts = 1;
	}

	const totalMs = performance.now() - startedAt;

	return {
		file: entry.path,
		coreMs: lexerMs + sllParseMs + llParseMs,
		adapterMs: totalMs,
		phases: { conditionalMs, setupMs, lexerMs, sllParseMs, llParseMs, totalMs },
		lexerDiagnostics: lexerErrors.count,
		parseDiagnostics: parserErrors.count,
		tokens: visibleTokens,
		hiddenTokens: tokens.length - visibleTokens,
		prediction: llAttempts > 0 ? 'sll-fallback-ll' : 'sll',
		sllAttempts: 1,
		llAttempts,
		peakRssBytes: process.memoryUsage().rss,
	};
};

const median = (values: readonly number[]): number => [...values].sort((left, right) => left - right)[Math.floor((values.length - 1) / 2)] ?? 0;
const merge = (observations: readonly Observation[]): Observation => {
	const last = observations.at(-1);

	if (last === undefined) {
		throw new Error('No observations');
	}

	return {
		...last,
		coreMs: median(observations.map((item) => item.coreMs)),
		adapterMs: median(observations.map((item) => item.adapterMs)),
	};
};

const sourceOf = (entry: FileEntry): string => readFileSync(path.join(filesDir, entry.file), 'utf8');
const results = selected.map((entry) => {
	const source = sourceOf(entry);

	if (stage !== 'warm') {
		return { observation: parse(source, entry) };
	}

	for (let warmup = 0; warmup < warmups; warmup += 1) {
		parse(source, entry);
	}

	const samples = Array.from({ length: iterations }, () => parse(source, entry));
	return { observation: merge(samples), samples };
});

process.stdout.write(`${JSON.stringify({ stage, files: results })}\n`);
