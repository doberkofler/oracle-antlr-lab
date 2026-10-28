import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareConditional } from '../conditional.ts';
import { type MemoryPassBody, summarizeJavaHistogram } from '../memory.ts';
import { type CorpusFile, type CorpusManifest, type ParseObservation, type ParserAdapter } from '../types.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const imageInputs = [
	'grammar/upstream/PlSqlLexer.g4',
	'grammar/upstream/PlSqlParser.g4',
	'java/Dockerfile',
	'java/pom.xml',
	'java/src/Main.java',
	'java/src/PlSqlLexerBase.java',
	'java/src/PlSqlParserBase.java',
];
const imageDigest = createHash('sha256');

for (const file of imageInputs) {
	imageDigest.update(file);
	imageDigest.update(readFileSync(path.join(root, file)));
}

const image = `oracle-antlr-lab-java:${imageDigest.digest('hex').slice(0, 12)}`;

/** Receives per-file progress from a Java harness line such as `[3/1244] elapsed`. */
export type JavaProgressListener = (completed: number, total: number) => void;

const docker = (args: readonly string[], inherit = false, forwardStderr = false, onProgress?: JavaProgressListener): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn('docker', args, { cwd: root, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let progressPending = '';

		if (!inherit && child.stdout !== null && child.stderr !== null) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.on('data', (chunk: string) => {
				stderr += chunk;

				if (forwardStderr) {
					process.stderr.write(`[java] ${chunk}`);
				}

				if (onProgress !== undefined) {
					progressPending += chunk;

					for (;;) {
						const newline = progressPending.indexOf('\n');

						if (newline < 0) {
							break;
						}
						const line = progressPending.slice(0, newline);
						progressPending = progressPending.slice(newline + 1);
						const match = /\[(?<completed>\d+)\/(?<total>\d+)\] elapsed/u.exec(line);

						if (match?.groups !== undefined) {
							onProgress(Number(match.groups['completed']), Number(match.groups['total']));
						}
					}
				}
			});
		}

		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`docker ${args.join(' ')} failed (${String(code)}):\n${stderr}`));
				return;
			}

			resolve(stdout);
		});
	});

const ensureImage = async (): Promise<void> => {
	const exists = await docker(['image', 'inspect', image]).then(
		() => true,
		() => false,
	);

	if (!exists) {
		await docker(['build', '-f', path.join(root, 'java', 'Dockerfile'), '-t', image, '.'], true);
	}
};

const runJava = async (
	input: Readonly<{ manifestPath: string; index: number; iterations: number; warmups: number; mode: 'cold' | 'warm' }>,
): Promise<ParseObservation> => {
	const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
	const entry = manifest.files.find((file) => file.id === input.index);

	if (entry === undefined) {
		throw new Error(`No corpus entry with index ${String(input.index)}`);
	}

	const corpusRoot = path.dirname(input.manifestPath);
	const output = await docker([
		'run',
		'--rm',
		'--network',
		'none',
		'-v',
		`${corpusRoot}:/corpus:ro`,
		image,
		`/corpus/files/${entry.file}`,
		String(input.iterations),
		String(input.warmups),
		input.mode,
	]);
	const parsed = JSON.parse(output.slice(output.indexOf('{'))) as Omit<ParseObservation, 'file'>;

	return { ...parsed, file: entry.path };
};

export type JavaRuleProfile = Readonly<{
	rule: string;
	timeInPredictionNs: number;
	invocations: number;
	sllAtnTransitions: number;
	sllDfaTransitions: number;
	llAtnTransitions: number;
	llDfaTransitions: number;
	llFallbacks: number;
	ambiguities: number;
}>;

export type JavaDecisionProfile = JavaRuleProfile & Readonly<{ decision: number }>;

export type JavaConformanceProfile = Readonly<{
	parseTreeSha256: string;
	maxFunctionArgumentsPerPart: number;
	parseDiagnostics: number;
}>;

export type JavaConformanceObservation = Readonly<{
	file: string;
	parseTreeSha256: string;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	tokens: number;
	hiddenTokens: number;
	prediction: 'sll' | 'sll-fallback-ll';
	llAttempts: number;
}>;

/** Symbolic Java token stream; token text and source offsets are excluded. */
export type JavaTokenObservation = Readonly<{
	file: string;
	types: readonly number[];
	channels: readonly number[];
}>;

const selectedEntries = (manifest: CorpusManifest, indexes: readonly number[]): readonly CorpusFile[] => {
	const byId = new Map(manifest.files.map((file) => [file.id, file]));

	return indexes.map((index) => {
		const entry = byId.get(index);

		if (entry === undefined) {
			throw new Error(`No corpus entry with index ${String(index)}`);
		}

		return entry;
	});
};

/**
 * Mirrors the production conditional-compilation boundary into a private mount.
 *
 * Java has no equivalent preprocessing implementation in this laboratory, so
 * semantic qualification must compare both targets against identical prepared
 * source. The temporary corpus is removed after the container exits.
 */
const withPreparedCorpus = async <Result>(
	input: Readonly<{ manifestPath: string; entries: readonly CorpusFile[]; conditional: boolean }>,
	action: (mountRoot: string) => Promise<Result>,
): Promise<Result> => {
	if (!input.conditional) {
		return action(path.dirname(input.manifestPath));
	}

	const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'oracle-antlr-lab-java-'));
	const filesRoot = path.join(temporaryRoot, 'files');

	try {
		for (const entry of input.entries) {
			const source = readFileSync(path.join(path.dirname(input.manifestPath), 'files', entry.file), 'utf8');
			const target = path.join(filesRoot, entry.file);
			mkdirSync(path.dirname(target), { recursive: true });
			writeFileSync(target, prepareConditional(source));
		}

		return await action(temporaryRoot);
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
};

/**
 * Runs the Java parser's cross-runtime conformance observation mode.
 *
 * @param input - Manifest, selected ids, and whether to apply the production
 * conditional-compilation boundary before Java receives the source.
 * @returns Per-file structural observations.
 */
export const runJavaConformance = async (
	input: Readonly<{ manifestPath: string; indexes: readonly number[]; conditional?: boolean }>,
	onProgress?: JavaProgressListener,
): Promise<readonly JavaConformanceObservation[]> => {
	await ensureImage();
	const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
	const entries = selectedEntries(manifest, input.indexes);
	const output = await withPreparedCorpus({ manifestPath: input.manifestPath, entries, conditional: input.conditional ?? true }, (mountRoot) =>
		docker(
			[
				'run',
				'--rm',
				'--network',
				'none',
				'-v',
				`${mountRoot}:/corpus:ro`,
				image,
				'conformance',
				...entries.map((entry) => `/corpus/files/${entry.file}`),
			],
			false,
			true,
			onProgress,
		),
	);
	const parsed = JSON.parse(output.slice(output.indexOf('{'))) as Readonly<{ files: readonly JavaConformanceObservation[] }>;

	return parsed.files.map((observation) => ({
		...observation,
		file: path.relative('/corpus/files', observation.file).split(path.sep).join('/'),
	}));
};

/**
 * Emits Java's symbolic token stream for cross-runtime diagnosis.
 *
 * @param input - Manifest, selected ids, and conditional-compilation mode.
 * @returns Per-file token types and channels; no token text is returned.
 */
export const runJavaTokens = async (
	input: Readonly<{ manifestPath: string; indexes: readonly number[]; conditional?: boolean }>,
	onProgress?: JavaProgressListener,
): Promise<readonly JavaTokenObservation[]> => {
	await ensureImage();
	const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
	const entries = selectedEntries(manifest, input.indexes);
	const output = await withPreparedCorpus({ manifestPath: input.manifestPath, entries, conditional: input.conditional ?? true }, (mountRoot) =>
		docker(
			['run', '--rm', '--network', 'none', '-v', `${mountRoot}:/corpus:ro`, image, 'tokens', ...entries.map((entry) => `/corpus/files/${entry.file}`)],
			false,
			true,
			onProgress,
		),
	);

	return output
		.split('\n')
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line) as JavaTokenObservation)
		.map((observation) => ({
			...observation,
			file: path.relative('/corpus/files', observation.file).split(path.sep).join('/'),
		}));
};

/** Profiles selected opaque corpus files with ANTLR's Java profiling simulator. */
export const runJavaProfile = async (
	input: Readonly<{ manifestPath: string; indexes: readonly number[] }>,
	onProgress?: JavaProgressListener,
): Promise<
	Readonly<{
		files: number;
		elapsedMs: number;
		profiles: readonly JavaRuleProfile[];
		decisions: readonly JavaDecisionProfile[];
		conformance: readonly JavaConformanceProfile[];
	}>
> => {
	await ensureImage();
	const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
	const corpusRoot = path.dirname(input.manifestPath);
	const byId = new Map(manifest.files.map((file) => [file.id, file]));
	const paths = input.indexes.map((index) => {
		const entry = byId.get(index);

		if (entry === undefined) {
			throw new Error(`No corpus entry with index ${String(index)}`);
		}

		return `/corpus/files/${entry.file}`;
	});
	const output = await docker(['run', '--rm', '--network', 'none', '-v', `${corpusRoot}:/corpus:ro`, image, 'profile', ...paths], false, true, onProgress);
	return JSON.parse(output.slice(output.indexOf('{'))) as Readonly<{
		files: number;
		elapsedMs: number;
		profiles: readonly JavaRuleProfile[];
		decisions: readonly JavaDecisionProfile[];
		conformance: readonly JavaConformanceProfile[];
	}>;
};

/**
 * Runs the Java memory harness in a fresh container.
 *
 * @param input - Manifest, selected ids, garbage-collection interval, and tree position.
 * @returns Instrumented memory pass.
 */
export const runJavaMemory = async (
	input: Readonly<{ manifestPath: string; indexes: readonly number[]; gcEvery: number; treePosition: number }>,
): Promise<MemoryPassBody> => {
	await ensureImage();
	const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
	const corpusRoot = path.dirname(input.manifestPath);
	const byId = new Map(manifest.files.map((file) => [file.id, file]));
	const ordered = input.indexes.map((index) => {
		const entry = byId.get(index);

		if (entry === undefined) {
			throw new Error(`No corpus entry with index ${String(index)}`);
		}

		return entry;
	});
	const output = await docker(
		[
			'run',
			'--rm',
			'--network',
			'none',
			'-v',
			`${corpusRoot}:/corpus:ro`,
			image,
			'memory',
			String(input.gcEvery),
			String(input.treePosition),
			...ordered.map((entry) => `/corpus/files/${entry.file}`),
		],
		false,
		true,
	);
	const parsed = JSON.parse(output.slice(output.indexOf('{'))) as JavaMemoryOutput;

	if (parsed.files.length !== input.indexes.length) {
		throw new Error(`Java memory harness reported ${String(parsed.files.length)} of ${String(input.indexes.length)} files`);
	}

	if (parsed.histogram.length === 0) {
		throw new Error('Java memory harness produced no class histogram');
	}

	const histogram = summarizeJavaHistogram(parsed.histogram);
	const retentionEntry = parsed.retention === null ? undefined : ordered[parsed.retention.position - 1];

	return {
		files: parsed.files.length,
		coreMs: parsed.coreMs,
		elapsedMs: parsed.elapsedMs,
		startupHeapBytes: parsed.startupHeapBytes,
		retainedEndBytes: parsed.retainedEndBytes,
		afterCacheClearBytes: parsed.afterCacheClearBytes,
		afterParserDropBytes: parsed.afterParserDropBytes,
		peakRssBytes: parsed.peakRssBytes,
		peakHeapUsedBytes: parsed.peakHeapUsedBytes,
		dfa: parsed.dfa,
		retention:
			parsed.retention === null || retentionEntry === undefined
				? null
				: {
						file: retentionEntry.path,
						tokens: parsed.retention.tokens,
						withTreeBytes: parsed.retention.withTreeBytes,
						withoutTreeBytes: parsed.retention.withoutTreeBytes,
						withoutSourceBytes: parsed.retention.withoutSourceBytes,
						withoutStreamBytes: parsed.retention.withoutStreamBytes,
						treeBytes: parsed.retention.treeBytes,
						sourceBytes: parsed.retention.sourceBytes,
						tokenBytes: parsed.retention.tokenBytes,
					},
		representativeHeap: null,
		allocation:
			parsed.allocation.bytes === 0 ? null : { source: 'jvm-thread-allocation', bytes: parsed.allocation.bytes, samplingIntervalBytes: null, top: [] },
		heap: histogram,
		checkpoints: parsed.files.map((entry) => {
			const corpusFile = ordered[entry.position - 1];

			if (corpusFile === undefined) {
				throw new Error(`Java memory harness reported unknown position ${String(entry.position)}`);
			}

			return {
				file: corpusFile.path,
				position: entry.position,
				coreMs: entry.coreMs,
				heapUsedBytes: entry.heapUsedBytes,
				retainedHeapBytes: entry.retainedHeapBytes,
				rssBytes: entry.rssBytes,
				dfaStates: entry.dfaStates,
				allocatedBytes: entry.allocatedBytes,
			};
		}),
		evidence: [],
	};
};

type JavaMemoryOutput = Readonly<{
	files: readonly Readonly<{
		position: number;
		coreMs: number;
		heapUsedBytes: number;
		retainedHeapBytes: number | null;
		rssBytes: number;
		dfaStates: number;
		allocatedBytes: number;
	}>[];
	elapsedMs: number;
	coreMs: number;
	startupHeapBytes: number;
	retainedEndBytes: number;
	afterCacheClearBytes: number;
	afterParserDropBytes: number;
	peakRssBytes: number;
	peakHeapUsedBytes: number;
	dfa: Readonly<{ decisions: number; states: number; retainedBytes: number }>;
	retention: Readonly<{
		position: number;
		tokens: number;
		withTreeBytes: number;
		withoutTreeBytes: number;
		withoutSourceBytes: number;
		withoutStreamBytes: number;
		treeBytes: number;
		sourceBytes: number;
		tokenBytes: number;
	}> | null;
	allocation: Readonly<{ source: string; bytes: number }>;
	histogram: readonly Readonly<{ className: string; instances: number; bytes: number }>[];
}>;

/**
 * Java-target adapter.
 *
 * Docker isolates a JVM per process. The one-pass value is a per-file pass, not
 * a shared corpus pass; the adapter identity records that limitation.
 */
export const javaAdapter: ParserAdapter = {
	identity: {
		name: 'java',
		language: 'Java',
		grammar: 'pinned upstream grammars-v4, unmodified target',
		runtime: 'antlr4-runtime 4.13.2',
		generator: 'antlr4-maven-plugin 4.13.2',
		extra: {
			metric: 'lexer + SLL parse',
			process: 'fresh Docker JVM per cold/warm invocation; JVM and container startup are not timed',
			onePass: 'one JVM; parser instances are per file; generated lexer/parser DFA caches persist across files',
			conditionalCompilation: 'benchmark path receives raw source; cross-runtime conformance mounts production-prepared source',
		},
	},
	prepare: ensureImage,
	run: async (input) => {
		await ensureImage();
		const cold = await runJava({ ...input, mode: 'cold' });
		const warm = await runJava({ ...input, mode: 'warm' });
		return { cold, warm, pass: cold };
	},
	runPass: async (input) => {
		await ensureImage();
		const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
		const corpusRoot = path.dirname(input.manifestPath);
		const byId = new Map(manifest.files.map((file) => [file.id, file]));
		const paths = input.indexes.map((index) => {
			const entry = byId.get(index);

			if (entry === undefined) {
				throw new Error(`No corpus entry with index ${String(index)}`);
			}

			return `/corpus/files/${entry.file}`;
		});
		const output = await docker(['run', '--rm', '--network', 'none', '-v', `${corpusRoot}:/corpus:ro`, image, 'pass', ...paths], false, true);
		const parsed = JSON.parse(output.slice(output.indexOf('{'))) as Readonly<{
			files: readonly (Omit<ParseObservation, 'file'> & { file: string })[];
		}>;

		return new Map(
			parsed.files.map((entry) => [
				path.relative('/corpus/files', entry.file).split(path.sep).join('/'),
				{ ...entry, file: path.relative('/corpus/files', entry.file) },
			]),
		);
	},
	available: async () =>
		docker(['info', '--format', '{{.ServerVersion}}']).then(
			() => true,
			() => false,
		),
};
