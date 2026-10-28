import { comparePolicy, describePolicy, type PolicyComparison, type ReportPolicy } from './benchmarkPolicy.ts';
import { selectionFingerprint, type BenchmarkSelection } from './selection.ts';
import { statistics } from './stats.ts';
import { type CorpusFile, type MetricStatistics, type ParseObservation } from './types.ts';

/** One completed cache-reuse pass from a production report. */
export type ProductionPassRun = Readonly<{
	repeat: number;
	wallMs: number;
	coreMs: number;
	adapterMs: number;
	setupMs: number;
	lexerMs: number;
	sllParseMs: number;
	llParseMs: number;
	peakRssBytes: number;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	llFallbackFiles: number;
	files: readonly ParseObservation[] | null;
}>;

/** Environment recorded by a production report. */
export type ReportEnvironment = Readonly<{
	node: string;
	platform: string;
	arch: string;
	release: string;
	cpuModel: string;
	logicalCpus: number;
	totalMemoryBytes: number;
}>;

/** Minimal production report shape used for control/candidate comparison. */
export type ProductionReport = Readonly<{
	experiment: string;
	generatedAt: string;
	environment: ReportEnvironment | null;
	corpus: Readonly<{
		id: string;
		sourceFiles: number;
		sourceBytes: number;
		selection: string;
		files: readonly CorpusFile[];
	}>;
	selection: BenchmarkSelection | null;
	/** Execution identity recorded with the campaign, when available. */
	policy: ReportPolicy | null;
	adapters: readonly Readonly<{ name: string }>[];
	runs: Readonly<Record<string, readonly ProductionPassRun[]>>;
}>;

/** Aggregate metrics compared across states. */
export type SummaryMetric =
	| 'wallMs'
	| 'coreMs'
	| 'adapterMs'
	| 'setupMs'
	| 'lexerMs'
	| 'sllParseMs'
	| 'llParseMs'
	| 'peakRssBytes'
	| 'llFallbackFiles'
	| 'lexerDiagnostics'
	| 'parseDiagnostics';

/** Per-adapter summary from repeated passes. */
export type AdapterSummary = Readonly<{ passes: number } & Record<SummaryMetric, MetricStatistics>>;

/** One paired per-file observation averaged across repetitions. */
export type PerFileComparison = Readonly<{
	file: string;
	coreDeltaMs: number;
	adapterDeltaMs: number;
	sllDeltaMs: number;
	llDeltaMs: number;
	controlFallback: 'always' | 'some' | 'never';
	candidateFallback: 'always' | 'some' | 'never';
	diagnosticDelta: number;
}>;

/** One compared adapter. */
export type ComparedAdapter = Readonly<{
	control: AdapterSummary;
	candidate: AdapterSummary;
	changePercent: Readonly<Record<SummaryMetric, number>>;
	paired: Readonly<Record<'coreMs' | 'adapterMs' | 'sllParseMs' | 'llParseMs' | 'setupMs', MetricStatistics>> | null;
	pairedSamples: number;
	fallback: Readonly<{
		controlFiles: number;
		candidateFiles: number;
		stopped: number;
		introduced: number;
		both: number;
		neither: number;
	}> | null;
	diagnostics: Readonly<{ controlPass: number; candidatePass: number; changedFiles: number }> | null;
	perFile: readonly PerFileComparison[] | null;
}>;

/** Complete control/candidate comparison. */
export type ComparisonReport = Readonly<{
	schemaVersion: 1;
	experiment: string;
	generatedAt: string;
	selection: Readonly<{ fingerprint: string; mode: string; files: number }>;
	corpus: Readonly<{ id: string; files: number }>;
	control: Readonly<{ artifact: string; experiment: string; generatedAt: string }>;
	candidate: Readonly<{ artifact: string; experiment: string; generatedAt: string }>;
	environment: Readonly<{ matches: boolean | null; control: ReportEnvironment | null; candidate: ReportEnvironment | null }>;
	policy: Readonly<PolicyComparison & { overridden: boolean }>;
	adapters: Readonly<Record<string, ComparedAdapter>>;
}>;

const SUMMARY_METRICS: readonly SummaryMetric[] = [
	'wallMs',
	'coreMs',
	'adapterMs',
	'setupMs',
	'lexerMs',
	'sllParseMs',
	'llParseMs',
	'peakRssBytes',
	'llFallbackFiles',
	'lexerDiagnostics',
	'parseDiagnostics',
];
const PAIRED_METRICS = ['coreMs', 'adapterMs', 'sllParseMs', 'llParseMs', 'setupMs'] as const;

/**
 * Selection identity of a production report.
 *
 * @param report - Parsed production report.
 * @returns Recorded fingerprint or one derived from the corpus files.
 */
export const reportFingerprint = (report: ProductionReport): string => report.selection?.fingerprint ?? selectionFingerprint(report.corpus.files);

/**
 * Compares two repeated production campaigns on the same selection.
 *
 * @param input - Experiment name, artifact labels, control, and candidate.
 * @returns Aggregate, paired, fallback, and diagnostic comparison.
 * @throws Error when the selections differ or no adapter is shared.
 */
export const compareReports = (
	input: Readonly<{
		experiment: string;
		controlArtifact: string;
		candidateArtifact: string;
		control: ProductionReport;
		candidate: ProductionReport;
		/** Allows differing heap or cache identities after explicit operator review. */
		allowPolicyMismatch?: boolean;
	}>,
): ComparisonReport => {
	const controlFingerprint = reportFingerprint(input.control);
	const candidateFingerprint = reportFingerprint(input.candidate);

	if (controlFingerprint !== candidateFingerprint) {
		throw new Error(`Selection fingerprint differs: control ${controlFingerprint}, candidate ${candidateFingerprint}`);
	}

	if (input.control.corpus.id !== input.candidate.corpus.id) {
		throw new Error(`Corpus differs: control ${input.control.corpus.id}, candidate ${input.candidate.corpus.id}`);
	}

	const policy = comparePolicy(input.control.policy, input.candidate.policy);

	if (policy.matches === false && input.allowPolicyMismatch !== true) {
		throw new Error(`Benchmark policy differs: ${policy.differences.join('; ')}. Rerun with --allow-policy-mismatch only when the difference is intended.`);
	}

	const adapters = Object.keys(input.control.runs).filter((name) => input.candidate.runs[name] !== undefined);

	if (adapters.length === 0) {
		throw new Error('Control and candidate share no adapter');
	}

	const compared = Object.fromEntries(adapters.map((name) => [name, compareAdapter(input.control, input.candidate, name)]));
	const controlEnvironment = input.control.environment;
	const candidateEnvironment = input.candidate.environment;

	return {
		schemaVersion: 1,
		experiment: input.experiment,
		generatedAt: new Date().toISOString(),
		selection: {
			fingerprint: controlFingerprint,
			mode: input.control.selection?.mode ?? 'unknown',
			files: input.control.corpus.files.length,
		},
		corpus: { id: input.control.corpus.id, files: input.control.corpus.files.length },
		control: { artifact: input.controlArtifact, experiment: input.control.experiment, generatedAt: input.control.generatedAt },
		candidate: { artifact: input.candidateArtifact, experiment: input.candidate.experiment, generatedAt: input.candidate.generatedAt },
		environment: {
			matches:
				controlEnvironment === null || candidateEnvironment === null
					? null
					: controlEnvironment.cpuModel === candidateEnvironment.cpuModel &&
						controlEnvironment.logicalCpus === candidateEnvironment.logicalCpus &&
						controlEnvironment.totalMemoryBytes === candidateEnvironment.totalMemoryBytes &&
						controlEnvironment.platform === candidateEnvironment.platform &&
						controlEnvironment.arch === candidateEnvironment.arch,
			control: controlEnvironment,
			candidate: candidateEnvironment,
		},
		policy: { ...policy, overridden: policy.matches === false },
		adapters: compared,
	};
};

const compareAdapter = (control: ProductionReport, candidate: ProductionReport, name: string): ComparedAdapter => {
	const controlRuns = control.runs[name] ?? [];
	const candidateRuns = candidate.runs[name] ?? [];

	if (controlRuns.length === 0 || candidateRuns.length === 0) {
		throw new Error(`Adapter ${name} has no completed passes in one state`);
	}

	const controlSummary = summarize(controlRuns);
	const candidateSummary = summarize(candidateRuns);
	const changePercent = Object.fromEntries(
		SUMMARY_METRICS.map((metric) => {
			const baseline = controlSummary[metric].mean;
			return [metric, baseline === 0 ? 0 : ((candidateSummary[metric].mean - baseline) / baseline) * 100];
		}),
	) as Record<SummaryMetric, number>;
	const controlFiles = observationMaps(controlRuns);
	const candidateFiles = observationMaps(candidateRuns);
	const pairedSamples = Math.min(controlFiles.length, candidateFiles.length);
	const paired =
		pairedSamples === 0
			? null
			: (Object.fromEntries(
					PAIRED_METRICS.map((metric) => {
						const deltas: number[] = [];

						for (let repeat = 0; repeat < pairedSamples; repeat += 1) {
							for (const file of control.corpus.files) {
								const baseline = controlFiles[repeat]?.get(file.file);
								const mutated = candidateFiles[repeat]?.get(file.file);

								if (baseline !== undefined && mutated !== undefined) {
									deltas.push(observationMetric(mutated, metric) - observationMetric(baseline, metric));
								}
							}
						}

						return [metric, statistics(deltas)];
					}),
				) as ComparedAdapter['paired']);
	const fallback = compareFallback(control.corpus.files, controlFiles, candidateFiles);
	const diagnostics = compareDiagnostics(control.corpus.files, controlFiles, candidateFiles);
	const perFile =
		pairedSamples === 0
			? []
			: control.corpus.files.flatMap((file) => {
					const core = fileDeltas(file.file, controlFiles, candidateFiles, 'coreMs');
					const adapter = fileDeltas(file.file, controlFiles, candidateFiles, 'adapterMs');
					const sll = fileDeltas(file.file, controlFiles, candidateFiles, 'sllParseMs');
					const ll = fileDeltas(file.file, controlFiles, candidateFiles, 'llParseMs');

					if (core.length === 0 || adapter.length === 0 || sll.length === 0 || ll.length === 0) {
						return [];
					}

					const controlFallback = fallbackState(file.file, controlFiles);
					const candidateFallback = fallbackState(file.file, candidateFiles);

					return [
						{
							file: file.file,
							coreDeltaMs: mean(core),
							adapterDeltaMs: mean(adapter),
							sllDeltaMs: mean(sll),
							llDeltaMs: mean(ll),
							controlFallback,
							candidateFallback,
							diagnosticDelta: firstDiagnostics(candidateFiles, file.file) - firstDiagnostics(controlFiles, file.file),
						},
					];
				});

	return {
		control: controlSummary,
		candidate: candidateSummary,
		changePercent,
		paired,
		pairedSamples,
		fallback,
		diagnostics,
		perFile: perFile.length === 0 ? null : perFile,
	};
};

const summarize = (runs: readonly ProductionPassRun[]): AdapterSummary => {
	const values = Object.fromEntries(SUMMARY_METRICS.map((metric) => [metric, statistics(runs.map((run) => run[metric]))])) as Record<
		SummaryMetric,
		MetricStatistics
	>;

	return { passes: runs.length, ...values };
};

const observationMaps = (runs: readonly ProductionPassRun[]): readonly ReadonlyMap<string, ParseObservation>[] => {
	const maps = runs.map((run) => new Map((run.files ?? []).map((observation) => [observation.file, observation])));
	return maps.every((map) => map.size > 0) ? maps : [];
};

const observationMetric = (observation: ParseObservation, metric: 'coreMs' | 'adapterMs' | 'sllParseMs' | 'llParseMs' | 'setupMs'): number =>
	metric === 'sllParseMs' || metric === 'llParseMs' || metric === 'setupMs' ? (observation.phases[metric] ?? 0) : observation[metric];

const fileDeltas = (
	file: string,
	control: readonly ReadonlyMap<string, ParseObservation>[],
	candidate: readonly ReadonlyMap<string, ParseObservation>[],
	metric: 'coreMs' | 'adapterMs' | 'sllParseMs' | 'llParseMs',
): readonly number[] => {
	const deltas: number[] = [];

	for (let repeat = 0; repeat < Math.min(control.length, candidate.length); repeat += 1) {
		const baseline = control[repeat]?.get(file);
		const mutated = candidate[repeat]?.get(file);

		if (baseline !== undefined && mutated !== undefined) {
			deltas.push(observationMetric(mutated, metric) - observationMetric(baseline, metric));
		}
	}

	return deltas;
};

const fallbackState = (file: string, runs: readonly ReadonlyMap<string, ParseObservation>[]): 'always' | 'some' | 'never' => {
	const states = runs.flatMap((run) => {
		const observation = run.get(file);
		return observation === undefined ? [] : [observation.llAttempts > 0];
	});

	if (states.length === 0) {
		return 'never';
	}

	return states.every(Boolean) ? 'always' : states.some(Boolean) ? 'some' : 'never';
};

const compareFallback = (
	files: readonly CorpusFile[],
	control: readonly ReadonlyMap<string, ParseObservation>[],
	candidate: readonly ReadonlyMap<string, ParseObservation>[],
): ComparedAdapter['fallback'] => {
	if (control.length === 0 || candidate.length === 0) {
		return null;
	}

	let controlFiles = 0;
	let candidateFiles = 0;
	let stopped = 0;
	let introduced = 0;
	let both = 0;
	let neither = 0;

	for (const file of files) {
		const baseline = fallbackState(file.file, control);
		const mutated = fallbackState(file.file, candidate);

		if (baseline !== 'never') {
			controlFiles += 1;
		}

		if (mutated !== 'never') {
			candidateFiles += 1;
		}

		if (baseline !== 'never' && mutated === 'never') {
			stopped += 1;
		} else if (baseline === 'never' && mutated !== 'never') {
			introduced += 1;
		} else if (baseline !== 'never' && mutated !== 'never') {
			both += 1;
		} else {
			neither += 1;
		}
	}

	return { controlFiles, candidateFiles, stopped, introduced, both, neither };
};

const compareDiagnostics = (
	files: readonly CorpusFile[],
	control: readonly ReadonlyMap<string, ParseObservation>[],
	candidate: readonly ReadonlyMap<string, ParseObservation>[],
): ComparedAdapter['diagnostics'] => {
	const controlFirst = control[0];
	const candidateFirst = candidate[0];

	if (controlFirst === undefined || candidateFirst === undefined) {
		return null;
	}

	let controlPass = 0;
	let candidatePass = 0;
	let changedFiles = 0;

	for (const file of files) {
		const baseline = controlFirst.get(file.file);
		const mutated = candidateFirst.get(file.file);
		const baselineCount = baseline === undefined ? 0 : baseline.lexerDiagnostics + baseline.parseDiagnostics;
		const mutatedCount = mutated === undefined ? 0 : mutated.lexerDiagnostics + mutated.parseDiagnostics;
		controlPass += baselineCount;
		candidatePass += mutatedCount;

		if (baselineCount !== mutatedCount) {
			changedFiles += 1;
		}
	}

	return { controlPass, candidatePass, changedFiles };
};

const firstDiagnostics = (runs: readonly ReadonlyMap<string, ParseObservation>[], file: string): number => {
	const observation = runs[0]?.get(file);
	return observation === undefined ? 0 : observation.lexerDiagnostics + observation.parseDiagnostics;
};

const mean = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Renders a control/candidate comparison.
 *
 * @param report - Compared campaigns.
 * @returns Markdown summary.
 */
export const renderComparisonMarkdown = (report: ComparisonReport): string => {
	const rows = Object.entries(report.adapters).map(([name, adapter]) => {
		const paired = adapter.paired;
		return `| ${name} | ${adapter.control.coreMs.mean.toFixed(3)} | ${adapter.candidate.coreMs.mean.toFixed(3)} | ${adapter.changePercent.coreMs.toFixed(2)}% | ${paired === null ? '—' : `${paired.coreMs.mean.toFixed(3)} [${paired.coreMs.meanCi95.lower.toFixed(3)}, ${paired.coreMs.meanCi95.upper.toFixed(3)}]`} | ${adapter.control.llFallbackFiles.max.toFixed(0)} → ${adapter.candidate.llFallbackFiles.max.toFixed(0)} | ${adapter.diagnostics === null ? '—' : `${String(adapter.diagnostics.controlPass)} → ${String(adapter.diagnostics.candidatePass)}`} |`;
	});
	const detailRows = Object.entries(report.adapters).flatMap(([name, adapter]) => {
		const paired = adapter.paired;
		return paired === undefined || paired === null
			? []
			: [
					`| ${name} | ${paired.coreMs.mean.toFixed(3)} | ${paired.sllParseMs.mean.toFixed(3)} | ${paired.llParseMs.mean.toFixed(3)} | ${paired.setupMs.mean.toFixed(3)} | ${paired.adapterMs.mean.toFixed(3)} | ${String(adapter.pairedSamples)} |`,
				];
	});

	return [
		`# ${report.experiment}`,
		'',
		`Selection ${report.selection.mode} ${report.selection.fingerprint.slice(0, 16)}…; ${String(report.corpus.files)} opaque files from ${report.corpus.id}.`,
		'',
		`Control: ${report.control.experiment} (${report.control.generatedAt}). Candidate: ${report.candidate.experiment} (${report.candidate.generatedAt}).`,
		'',
		`Environment match: ${report.environment.matches === null ? 'not recorded' : report.environment.matches ? 'yes' : 'no'}.`,
		'',
		`Policy identity: ${
			report.policy.matches === null
				? 'not recorded in one or both reports'
				: report.policy.matches
					? 'match'
					: `MISMATCH${report.policy.overridden ? ' (overridden)' : ''}: ${report.policy.differences.join('; ')}`
		}.`,
		'',
		`Control policy: ${report.policy.control === null ? 'not recorded' : describePolicy(report.policy.control)}. Candidate policy: ${report.policy.candidate === null ? 'not recorded' : describePolicy(report.policy.candidate)}.`,
		'',
		'| Adapter | Control core mean ms | Candidate core mean ms | Change | Paired core delta ms [bootstrap 95% CI] | LL fallback files | Diagnostics first pass |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		...rows,
		'',
		'| Adapter | Paired core ms | Paired SLL ms | Paired LL ms | Paired setup ms | Paired adapter ms | Samples |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		...detailRows,
		'',
		'Paired deltas are candidate minus control over identical files and repetitions. A negative delta is faster.',
		'',
	].join('\n');
};
