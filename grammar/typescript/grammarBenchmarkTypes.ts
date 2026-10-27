/** One timed parse in the grammar-state benchmark harness. */
export type GrammarBenchmarkObservation = Readonly<{
	file: string;
	bytes: number;
	coreMs: number;
	adapterMs: number;
	phases: Readonly<{
		conditionalMs: number;
		setupMs: number;
		lexerMs: number;
		sllParseMs: number;
		llParseMs: number;
		totalMs: number;
	}>;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	tokens: number;
	hiddenTokens: number;
	prediction: 'sll' | 'sll-fallback-ll';
	llAttempts: number;
	peakRssBytes: number;
}>;

/** Output of one grammar-state benchmark pass. */
export type GrammarBenchmarkOutput = Readonly<{
	state: string;
	files: readonly GrammarBenchmarkObservation[];
}>;
