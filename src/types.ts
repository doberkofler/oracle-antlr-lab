/** One source selected for a benchmark run. */
export type CorpusFile = Readonly<{
	id: number;
	/** Workspace-relative path used as the source identity. */
	path: string;
	/** Relative path under the corpus content directory. */
	file: string;
	bytes: number;
	lines: number;
	sha256: string;
}>;

/** A reproducible corpus selection. */
export type CorpusManifest = Readonly<{
	id: string;
	description: string;
	visibility: 'public' | 'private';
	/** Absolute directory that contains manifest.json and files/. */
	root: string;
	sourceFiles: number;
	sourceBytes: number;
	selection: string;
	files: readonly CorpusFile[];
}>;

/** Stable identity of a parser implementation and its inputs. */
export type ParserIdentity = Readonly<{
	name: string;
	language: string;
	grammar: string;
	runtime: string;
	generator?: string;
	extra?: Readonly<Record<string, string>>;
}>;

/** One parse result, independent of language and semantic consumers. */
export type ParseObservation = Readonly<{
	file: string;
	/** Lexer plus parser time; excludes conditional preparation and semantic visitors. */
	coreMs: number;
	/** Whole adapter call, including preparation. */
	adapterMs: number;
	phases: Readonly<Record<string, number>>;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	tokens: number;
	hiddenTokens: number;
	prediction: 'sll' | 'sll-fallback-ll' | 'll' | 'unknown';
	sllAttempts: number;
	llAttempts: number;
	peakRssBytes: number;
}>;

/** One measurement of one file. */
export type ParsedFileRun = Readonly<{
	observedAt: string;
	cold: ParseObservation;
	warmSamples: readonly ParseObservation[];
	pass: ParseObservation;
}>;

/** Adapter contract implemented by every language harness. */
export type ParserAdapter = Readonly<{
	identity: ParserIdentity;
	/**
	 * Runs a cold parse, a warm repeated parse, and one corpus pass.
	 *
	 * @param input - Absolute paths, repetition counts, and the selected file index.
	 * @returns One observation per stage.
	 */
	run: (input: Readonly<{ manifestPath: string; filesDir: string; iterations: number; warmups: number; index: number }>) => Promise<{
		cold: ParseObservation;
		warm: ParseObservation;
		pass: ParseObservation;
	}>;
	/**
	 * Optional shared corpus pass. When absent, the per-file pass is used and
	 * must be reported as per-file.
	 */
	runPass?: (input: Readonly<{ manifestPath: string; filesDir: string; indexes: readonly number[] }>) => Promise<ReadonlyMap<string, ParseObservation>>;
	/** Returns false when the adapter runtime is unavailable. */
	available: () => Promise<boolean>;
}>;

/** Statistics for one metric. */
export type MetricStatistics = Readonly<{
	count: number;
	mean: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
}>;

/** One complete, machine-readable experiment result. */
export type BenchmarkReport = Readonly<{
	schemaVersion: 1;
	experiment: string;
	hypothesis: string;
	generatedAt: string;
	environment: Readonly<{
		node: string;
		platform: string;
		arch: string;
		release: string;
		cpuModel: string;
		logicalCpus: number;
		totalMemoryBytes: number;
	}>;
	corpus: Omit<CorpusManifest, 'root'>;
	adapters: readonly ParserIdentity[];
	config: Readonly<{
		iterations: number;
		warmups: number;
		coldRepeats: number;
		defaultSchema: string;
	}>;
	aggregate: Readonly<Record<string, Readonly<Record<'cold' | 'coldAdapter' | 'coldSetup' | 'warm' | 'pass', MetricStatistics>>>>;
	perFile: readonly Readonly<{
		file: CorpusFile;
		adapters: Readonly<Record<string, ParsedFileRun>>;
	}>[];
	failures: readonly Readonly<{ adapter: string; file: string; message: string }>[];
}>;
