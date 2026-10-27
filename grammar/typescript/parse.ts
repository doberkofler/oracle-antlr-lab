import { BaseErrorListener, CharStream, CommonTokenStream, type ParseTree, type ParseTreeListener, Token } from 'antlr4ng';
import { prepareConditional } from '../../src/conditional.ts';
import { PlSqlLexer } from './generated/PlSqlLexer.ts';
import { PlSqlParser } from './generated/PlSqlParser.ts';
import { treeSha256 } from './treeDigest.ts';

export { treeSha256 } from './treeDigest.ts';

/** Corpus entry as recorded in a manifest. */
export type FileEntry = Readonly<{ id: number; path: string; file: string; bytes: number; lines: number; sha256: string }>;

/** Phase boundaries reported by the TypeScript harness. */
export type PhaseTimings = Readonly<{
	conditionalMs: number;
	setupMs: number;
	lexerMs: number;
	sllParseMs: number;
	llParseMs: number;
	totalMs: number;
}>;

/** One timed TypeScript parse. */
export type HarnessObservation = Readonly<{
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
	parseTreeSha256?: string;
}>;

/** Retained parse state; callers that only need the observation may discard it. */
export type ParsedSource = Readonly<{
	observation: HarnessObservation;
	tree: ParseTree;
	stream: CommonTokenStream;
	parser: PlSqlParser;
	source: string;
}>;

/** Transaction boundary for semantic extraction during parsing. */
export type StreamingParseSink = Readonly<{
	listenerFor: (mode: 'sll' | 'll') => ParseTreeListener;
	commit: (mode: 'sll' | 'll') => void;
	rollback: (mode: 'sll') => void;
}>;

/** Collects syntax errors without writing to stderr. */
export class ErrorCollector extends BaseErrorListener {
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

/**
 * Parses one source with the production lexer/SLL-first/LL-fallback sequence.
 *
 * @param source - Oracle source text.
 * @param entry - Corpus entry that owns the source.
 * @param options - Optional parse-tree digest.
 * @returns Observation plus the retained parse tree, token stream, and parser.
 */
export const parseSource = (source: string, entry: FileEntry, options: Readonly<{ treeHash?: boolean }> = {}): ParsedSource =>
	parse(source, entry, { buildParseTrees: true, treeHash: options.treeHash === true });

/**
 * Parses while emitting transactional listener events without retaining a tree.
 *
 * The sink must discard SLL attempt state when `rollback` is called. Exactly one
 * attempt is committed. Existing retained-tree callers should use `parseSource`.
 *
 * @param source - Oracle source text.
 * @param entry - Corpus entry that owns the source.
 * @param sink - Transactional semantic-event consumer.
 * @returns Parse observation; parser, token stream, source, and tree are released.
 */
export const parseSourceStreaming = (source: string, entry: FileEntry, sink: StreamingParseSink): HarnessObservation =>
	parse(source, entry, { buildParseTrees: false, sink, treeHash: false }).observation;

const parse = (
	source: string,
	entry: FileEntry,
	options: Readonly<{ buildParseTrees: boolean; sink?: StreamingParseSink; treeHash: boolean }>,
): ParsedSource => {
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
		parser.buildParseTrees = options.buildParseTrees;

		if (options.sink !== undefined) {
			parser.addParseListener(options.sink.listenerFor(mode));
		}

		interpreter.predictionMode = mode === 'sll' ? 0 : 1;
		return parser;
	};

	const parserErrors = new ErrorCollector();
	let parser = parserFor('sll');
	const sllStarted = performance.now();
	let tree = parser.sql_script();
	const sllParseMs = performance.now() - sllStarted;
	let llParseMs = 0;
	let llAttempts = 0;

	if (parserErrors.count > 0) {
		options.sink?.rollback('sll');
		parserErrors.clear();
		stream.seek(0);
		parser = parserFor('ll');
		const llStarted = performance.now();
		tree = parser.sql_script();
		llParseMs = performance.now() - llStarted;
		llAttempts = 1;
	}
	options.sink?.commit(llAttempts > 0 ? 'll' : 'sll');

	const totalMs = performance.now() - startedAt;

	return {
		observation: {
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
			peakRssBytes: process.resourceUsage().maxRSS * 1024,
			...(options.treeHash ? { parseTreeSha256: treeSha256(tree) } : {}),
		},
		tree,
		stream,
		parser,
		source,
	};
};
