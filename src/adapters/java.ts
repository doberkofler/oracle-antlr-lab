import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type MemoryPassBody, summarizeJavaHistogram } from '../memory.ts';
import { type CorpusManifest, type ParseObservation, type ParserAdapter } from '../types.ts';

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

const docker = (args: readonly string[], inherit = false, forwardStderr = false): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn('docker', args, { cwd: root, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';

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

/** Runs the Java parser's cross-runtime conformance observation mode. */
export const runJavaConformance = async (
	input: Readonly<{ manifestPath: string; indexes: readonly number[] }>,
): Promise<readonly JavaConformanceObservation[]> => {
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
	const output = await docker(['run', '--rm', '--network', 'none', '-v', `${corpusRoot}:/corpus:ro`, image, 'conformance', ...paths], false, true);
	const parsed = JSON.parse(output.slice(output.indexOf('{'))) as Readonly<{ files: readonly JavaConformanceObservation[] }>;

	return parsed.files.map((observation) => ({
		...observation,
		file: path.relative('/corpus/files', observation.file).split(path.sep).join('/'),
	}));
};

/** Profiles selected opaque corpus files with ANTLR's Java profiling simulator. */
export const runJavaProfile = async (
	input: Readonly<{ manifestPath: string; indexes: readonly number[] }>,
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
	const output = await docker(['run', '--rm', '--network', 'none', '-v', `${corpusRoot}:/corpus:ro`, image, 'profile', ...paths], false, true);
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
