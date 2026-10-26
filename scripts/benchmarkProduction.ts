import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { javaAdapter } from '../src/adapters/java.ts';
import { typeScriptAdapter } from '../src/adapters/typescript.ts';
import { loadManifest } from '../src/corpus.ts';
import { statistics } from '../src/stats.ts';
import { type CorpusFile, type MetricStatistics, type ParseObservation, type ParserAdapter } from '../src/types.ts';

type PassRun = Readonly<{
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
	files: readonly ParseObservation[];
}>;

type Stratum = Readonly<{ name: string; files: readonly CorpusFile[] }>;

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, '.work', 'private-production', 'manifest.json'));
const repeats = positiveInteger(process.argv[3] ?? '3');
const experiment = process.argv[4] ?? '003-production-scale';
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files } = loadManifest(manifestPath, filesDir);

if (manifest.visibility !== 'private') {
	throw new Error('Production benchmark requires a private manifest');
}

if (files.some((file) => !/^source-\d{6}\.[a-z0-9]+$/u.test(file.path) || file.file !== file.path)) {
	throw new Error('Private manifest contains a non-opaque file identity');
}

const adapters: readonly ParserAdapter[] = [typeScriptAdapter, javaAdapter];
const indexes = files.map((file) => file.id);
const runs: Record<string, PassRun[]> = {};
const campaignStartedAt = performance.now();
const selectedBytes = files.reduce((total, file) => total + file.bytes, 0);
const corpusFraction = manifest.sourceBytes === 0 ? 1 : selectedBytes / manifest.sourceBytes;
const estimatedPassMs: Record<string, number> = {
	typescript: Math.max(15_000, 180_000 * corpusFraction),
	java: Math.max(10_000, 60_000 * corpusFraction),
};
const totalPasses = adapters.length * repeats;
let completedPasses = 0;
const initialEstimateMs = adapters.reduce((total, adapter) => total + (estimatedPassMs[adapter.identity.name] ?? 180_000) * repeats, 0);
const initialCompletesAt = new Date(Date.now() + initialEstimateMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

process.stdout.write(
	`Starting ${String(totalPasses)} campaign passes over ${String(files.length)} files; initial ETA ${formatDuration(initialEstimateMs)} (~${initialCompletesAt}).\n`,
);

for (const adapter of adapters) {
	if (!(await adapter.available())) {
		throw new Error(`${adapter.identity.name} runtime unavailable`);
	}

	process.stdout.write(`Preparing ${adapter.identity.name} outside measured intervals (ETA 0–5 minutes).\n`);
	await adapter.prepare?.();
	const adapterRuns: PassRun[] = [];

	for (let repeat = 1; repeat <= repeats; repeat += 1) {
		process.stdout.write(
			`Overall pass ${String(completedPasses + 1)}/${String(totalPasses)} (${formatPercentage(completedPasses, totalPasses)} complete): ${adapter.identity.name} ${String(repeat)}/${String(repeats)} starting.\n`,
		);
		const startedAt = performance.now();
		const observations = await adapter.runPass?.({ manifestPath, filesDir, indexes });

		if (observations === undefined || observations.size !== files.length) {
			throw new Error(`${adapter.identity.name} returned ${String(observations?.size ?? 0)} of ${String(files.length)} files`);
		}

		const ordered = files.map((file) => {
			const observation = observations.get(file.path);

			if (observation === undefined) {
				throw new Error(`${adapter.identity.name} omitted ${file.path}`);
			}

			return observation;
		});
		const run = summarizeRun(repeat, performance.now() - startedAt, ordered);
		adapterRuns.push(run);
		completedPasses += 1;
		estimatedPassMs[adapter.identity.name] = adapterRuns.reduce((total, completedRun) => total + completedRun.wallMs, 0) / adapterRuns.length;
		const remainingMs = adapters.reduce((total, pendingAdapter) => {
			const completed = runs[pendingAdapter.identity.name]?.length ?? (pendingAdapter.identity.name === adapter.identity.name ? adapterRuns.length : 0);
			return total + (repeats - completed) * (estimatedPassMs[pendingAdapter.identity.name] ?? 180_000);
		}, 0);
		const completesAt = new Date(Date.now() + remainingMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		process.stdout.write(
			`Overall ${String(completedPasses)}/${String(totalPasses)} (${formatPercentage(completedPasses, totalPasses)} complete); ${adapter.identity.name} pass completed in ${formatDuration(run.wallMs)}; core ${run.coreMs.toFixed(3)} ms; peak RSS ${formatBytes(run.peakRssBytes)}; campaign elapsed ${formatDuration(performance.now() - campaignStartedAt)}; remaining ETA ${formatDuration(remainingMs)} (~${completesAt}).\n`,
		);
	}

	runs[adapter.identity.name] = adapterRuns;
}

const strata = sizeStrata(files);
const aggregate = Object.fromEntries(
	adapters.map((adapter) => {
		const adapterRuns = runs[adapter.identity.name] ?? [];
		return [
			adapter.identity.name,
			{
				wallMs: statistics(adapterRuns.map((run) => run.wallMs)),
				coreMs: statistics(adapterRuns.map((run) => run.coreMs)),
				adapterMs: statistics(adapterRuns.map((run) => run.adapterMs)),
				peakRssBytes: statistics(adapterRuns.map((run) => run.peakRssBytes)),
			},
		];
	}),
);
const stratumResults = Object.fromEntries(
	adapters.map((adapter) => [
		adapter.identity.name,
		strata.map((stratum) => ({
			name: stratum.name,
			files: stratum.files.length,
			minBytes: Math.min(...stratum.files.map((file) => file.bytes)),
			maxBytes: Math.max(...stratum.files.map((file) => file.bytes)),
			coreMs: statistics(
				(runs[adapter.identity.name] ?? []).map((run) => stratum.files.reduce((total, file) => total + (run.files[file.id]?.coreMs ?? 0), 0)),
			),
			llFallbackFiles: Math.max(
				0,
				...(runs[adapter.identity.name] ?? []).map((run) => stratum.files.filter((file) => (run.files[file.id]?.llAttempts ?? 0) > 0).length),
			),
		})),
	]),
);
const rawReport = {
	schemaVersion: 1,
	experiment,
	generatedAt: new Date().toISOString(),
	corpus: {
		id: manifest.id,
		description: manifest.description,
		visibility: manifest.visibility,
		sourceFiles: manifest.sourceFiles,
		sourceBytes: manifest.sourceBytes,
		selection: manifest.selection,
		files,
	},
	config: { repeats, pass: 'one fresh process per repetition; generated DFA caches persist across files within a repetition' },
	adapters: adapters.map((adapter) => adapter.identity),
	aggregate,
	strata: stratumResults,
	runs,
};
const publishedRuns = Object.fromEntries(Object.entries(runs).map(([name, adapterRuns]) => [name, adapterRuns.map(({ files: _files, ...run }) => run)]));
const report = { ...rawReport, runs: publishedRuns };
const output = path.join(root, 'results', experiment);

mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'raw-report.json'), `${JSON.stringify(rawReport, null, 2)}\n`);
writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(output, 'report.md'), renderMarkdown(experiment, manifest.id, files.length, aggregate, stratumResults, runs));
process.stdout.write(`Reports: ${path.relative(root, output)}/report.md and raw-report.json (external evidence only)\n`);

function positiveInteger(value: string): number {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error('repeats must be a positive integer');
	}

	return parsed;
}

function summarizeRun(repeat: number, wallMs: number, observations: readonly ParseObservation[]): PassRun {
	const sum = (metric: (observation: ParseObservation) => number): number => observations.reduce((total, observation) => total + metric(observation), 0);

	return {
		repeat,
		wallMs,
		coreMs: sum((observation) => observation.coreMs),
		adapterMs: sum((observation) => observation.adapterMs),
		setupMs: sum((observation) => observation.phases['setupMs'] ?? 0),
		lexerMs: sum((observation) => observation.phases['lexerMs'] ?? 0),
		sllParseMs: sum((observation) => observation.phases['sllParseMs'] ?? 0),
		llParseMs: sum((observation) => observation.phases['llParseMs'] ?? 0),
		peakRssBytes: Math.max(...observations.map((observation) => observation.peakRssBytes)),
		lexerDiagnostics: sum((observation) => observation.lexerDiagnostics),
		parseDiagnostics: sum((observation) => observation.parseDiagnostics),
		llFallbackFiles: observations.filter((observation) => observation.llAttempts > 0).length,
		files: observations,
	};
}

function sizeStrata(input: readonly CorpusFile[]): readonly Stratum[] {
	const sorted = [...input].sort((left, right) => left.bytes - right.bytes || left.id - right.id);
	const labels = ['Q1 smallest', 'Q2', 'Q3', 'Q4 largest'];
	return labels.map((name, index) => ({
		name,
		files: sorted.slice(Math.floor((index * sorted.length) / labels.length), Math.floor(((index + 1) * sorted.length) / labels.length)),
	}));
}

function renderMarkdown(
	experimentName: string,
	corpusId: string,
	fileCount: number,
	aggregateResults: Readonly<Record<string, Readonly<Record<'wallMs' | 'coreMs' | 'adapterMs' | 'peakRssBytes', MetricStatistics>>>>,
	renderedStrata: Readonly<
		Record<
			string,
			readonly Readonly<{ name: string; files: number; minBytes: number; maxBytes: number; coreMs: MetricStatistics; llFallbackFiles: number }>[]
		>
	>,
	passRuns: Readonly<Record<string, readonly PassRun[]>>,
): string {
	const adapterRows = Object.entries(aggregateResults).map(([name, metrics]) => {
		const fallback = Math.max(0, ...(passRuns[name] ?? []).map((run) => run.llFallbackFiles));
		const diagnostics = Math.max(0, ...(passRuns[name] ?? []).map((run) => run.lexerDiagnostics + run.parseDiagnostics));
		return `| ${name} | ${metrics.wallMs.mean.toFixed(3)} [${metrics.wallMs.meanCi95.lower.toFixed(3)}, ${metrics.wallMs.meanCi95.upper.toFixed(3)}] | ${(metrics.wallMs.coefficientOfVariation * 100).toFixed(2)}% | ${metrics.coreMs.mean.toFixed(3)} | ${formatBytes(metrics.peakRssBytes.max)} | ${String(fallback)} | ${String(diagnostics)} |`;
	});
	const stratumRows = Object.entries(renderedStrata).flatMap(([name, entries]) =>
		entries.map(
			(entry) =>
				`| ${name} | ${entry.name} | ${String(entry.files)} | ${formatBytes(entry.minBytes)}–${formatBytes(entry.maxBytes)} | ${entry.coreMs.mean.toFixed(3)} | ${entry.coreMs.meanCi95.lower.toFixed(3)}–${entry.coreMs.meanCi95.upper.toFixed(3)} | ${String(entry.llFallbackFiles)} |`,
		),
	);

	return [
		`# ${experimentName}`,
		'',
		`Corpus: ${corpusId}, ${String(fileCount)} opaque files. Three fresh-process cache-reuse passes unless config states otherwise.`,
		'',
		'| Adapter | Wall mean ms [bootstrap 95% CI] | Wall CV | Core mean ms | Peak RSS max | LL fallback files | Diagnostics max |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		...adapterRows,
		'',
		'| Adapter | Size stratum | Files | Byte range | Core mean ms | Bootstrap 95% CI | LL fallback files |',
		'| --- | --- | ---: | ---: | ---: | ---: | ---: |',
		...stratumRows,
		'',
		'Wall time includes child process/container startup and source loading. Core time is lexer plus SLL and LL parsing. Peak RSS is the process high-water mark.',
		'',
	].join('\n');
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.round(milliseconds / 1_000);
	return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatPercentage(completed: number, total: number): string {
	return `${((completed / total) * 100).toFixed(1)}%`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1_000) {
		return `${String(bytes)} B`;
	}

	if (bytes < 1_000_000) {
		return `${(bytes / 1_000).toFixed(1)} kB`;
	}

	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
