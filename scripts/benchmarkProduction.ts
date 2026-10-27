import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import path from 'node:path';
import { javaAdapter } from '../src/adapters/java.ts';
import { typeScriptAdapter } from '../src/adapters/typescript.ts';
import { loadManifest } from '../src/corpus.ts';
import { type BenchmarkSelection, resolveBenchmarkSelection, type SelectionMode } from '../src/selection.ts';
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

type Aggregate = Readonly<
	Record<
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
		| 'parseDiagnostics',
		MetricStatistics
	>
>;

const usage = `Usage: pnpm benchmark:production [manifest] [repeats] [experiment] [options]

Positional arguments remain supported for existing experiment records.

Options:
  --manifest <path>          Corpus manifest (default: .work/private-production/manifest.json)
  --repeats <n>              Fresh-process cache-reuse repetitions (default: 3)
  --experiment <name>        Report directory name (default: production)
  --selection <mode>         full, q4, or tail (default: full)
  --tail-size <n>            Tail file count (default: 12)
  --selection-source <path>  Audited report that justifies q4/tail; use "manifest" for q4 without one
  --dry-run                  Resolve and print the selection without running a campaign
  --help                     Show this message

Selections:
  q4    Largest byte-size quartile; default source experiments/003-production-scale/report.json
  tail  Highest median TypeScript parser-core files; default source experiments/004-bottleneck-profile/report.json
`;

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));
const manifestPath = path.resolve(parsed.manifest);
const repeats = parsed.repeats;
const experiment = parsed.experiment;
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files: population } = loadManifest(manifestPath, filesDir);

if (manifest.visibility === 'private') {
	const opaque = /^source-\d{6}\.[a-z0-9]+$/u;

	if (population.some((file) => !opaque.test(file.path) || file.file !== file.path)) {
		throw new Error('Private manifest contains a non-opaque file identity');
	}
}

const selection = resolveBenchmarkSelection({
	mode: parsed.selection,
	manifest,
	manifestPath,
	workspaceRoot: root,
	source: parsed.selectionSource,
	tailSize: parsed.tailSize,
});
const byIdentity = new Map(population.map((file) => [file.file, file]));
const files = selection.files.map((selected) => {
	const file = byIdentity.get(selected.file);

	if (file === undefined || file.sha256 !== selected.sha256) {
		throw new Error(`Selection does not match manifest file ${selected.file}`);
	}

	return file;
});

if (parsed.dryRun) {
	process.stdout.write(
		`${selection.mode}: ${String(selection.selected.files)} files, ${String(selection.selected.minBytes)}–${String(selection.selected.maxBytes)} bytes, fingerprint ${selection.fingerprint}\nSource: ${selection.artifact.kind} ${selection.artifact.path ?? 'in-memory'} (${selection.artifact.sha256})\nCriteria: ${selection.criteria}\n`,
	);
	process.exit(0);
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
	`Starting ${String(totalPasses)} campaign passes over ${String(files.length)} ${selection.mode} files; initial ETA ${formatDuration(initialEstimateMs)} (~${initialCompletesAt}).\n`,
);
process.stdout.write(`Selection: ${selection.criteria}\n`);

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

const strata = selection.mode === 'full' ? sizeStrata(files) : [{ name: selection.mode === 'q4' ? 'Q4 largest' : 'Tail highest cost', files }];
const aggregate = Object.fromEntries(
	adapters.map((adapter) => {
		const adapterRuns = runs[adapter.identity.name] ?? [];
		return [adapter.identity.name, aggregateRuns(adapterRuns)];
	}),
);
const stratumResults = Object.fromEntries(
	adapters.map((adapter) => [
		adapter.identity.name,
		strata.map((stratum) => {
			const adapterRuns = runs[adapter.identity.name] ?? [];
			return {
				name: stratum.name,
				files: stratum.files.length,
				minBytes: Math.min(...stratum.files.map((file) => file.bytes)),
				maxBytes: Math.max(...stratum.files.map((file) => file.bytes)),
				coreMs: statistics(
					adapterRuns.map((run) =>
						stratum.files.reduce((total, file) => total + (run.files.find((entry) => entry.file === file.path)?.coreMs ?? 0), 0),
					),
				),
				llFallbackFiles: Math.max(
					0,
					...adapterRuns.map(
						(run) => stratum.files.filter((file) => (run.files.find((entry) => entry.file === file.path)?.llAttempts ?? 0) > 0).length,
					),
				),
			};
		}),
	]),
);
const environment = {
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	release: release(),
	cpuModel: cpus()[0]?.model ?? 'unknown',
	logicalCpus: cpus().length,
	totalMemoryBytes: totalmem(),
};
const rawReport = {
	schemaVersion: 1,
	experiment,
	generatedAt: new Date().toISOString(),
	environment,
	selection,
	corpus: {
		id: manifest.id,
		description: manifest.description,
		visibility: manifest.visibility,
		sourceFiles: manifest.sourceFiles,
		sourceBytes: manifest.sourceBytes,
		selection: selection.criteria,
		files,
	},
	config: {
		repeats,
		selection: selection.mode,
		pass: 'one fresh process per repetition; generated DFA caches persist across files within a repetition',
		typeScriptDfaClearEveryFiles: process.env['LAB_DFA_CLEAR_EVERY'] ?? 'never',
		typeScriptDfaMaxHeapMiB: process.env['LAB_DFA_MAX_HEAP_MIB'] ?? 'never',
	},
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
writeFileSync(path.join(output, 'selection.json'), `${JSON.stringify(selection, null, 2)}\n`);
writeFileSync(path.join(output, 'report.md'), renderMarkdown(experiment, selection, aggregate, stratumResults, runs));
process.stdout.write(`Reports: ${path.relative(root, output)}/report.md, selection.json, and raw-report.json (external evidence only)\n`);

function parseArguments(args: readonly string[]): Readonly<{
	manifest: string;
	repeats: number;
	experiment: string;
	selection: SelectionMode;
	tailSize: number;
	selectionSource: string | undefined;
	dryRun: boolean;
}> {
	const positionals: string[] = [];
	let manifestValue = path.join(root, '.work', 'private-production', 'manifest.json');
	let repeatCount = 3;
	let experimentName = 'production';
	let selectionMode: SelectionMode = 'full';
	let tailSize = 12;
	let selectionSource: string | undefined;
	let dryRun = false;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument === undefined) {
			throw new Error('Missing argument');
		}

		if (argument === '--help') {
			process.stdout.write(usage);
			process.exit(0);
		}

		if (argument === '--dry-run') {
			dryRun = true;
			continue;
		}

		if (!argument.startsWith('--')) {
			positionals.push(argument);
			continue;
		}

		const value = args[index + 1];

		if (value === undefined) {
			throw new Error(`Missing value for ${argument}`);
		}

		switch (argument) {
			case '--manifest': {
				manifestValue = path.resolve(value);
				break;
			}
			case '--repeats': {
				repeatCount = positiveInteger(value);
				break;
			}
			case '--experiment': {
				experimentName = value;
				break;
			}
			case '--selection': {
				if (value !== 'full' && value !== 'q4' && value !== 'tail') {
					throw new Error('--selection must be full, q4, or tail');
				}

				selectionMode = value;
				break;
			}
			case '--tail-size': {
				tailSize = positiveInteger(value);
				break;
			}
			case '--selection-source': {
				selectionSource = value;
				break;
			}
			default: {
				throw new Error(`Unknown argument: ${argument}`);
			}
		}

		index += 1;
	}

	if (positionals[0] !== undefined) {
		manifestValue = path.resolve(positionals[0]);
	}

	if (positionals[1] !== undefined) {
		repeatCount = positiveInteger(positionals[1]);
	}

	if (positionals[2] !== undefined) {
		experimentName = positionals[2];
	}

	if (positionals.length > 3) {
		throw new Error('Too many positional arguments');
	}

	return { manifest: manifestValue, repeats: repeatCount, experiment: experimentName, selection: selectionMode, tailSize, selectionSource, dryRun };
}

function positiveInteger(value: string): number {
	const parsedValue = Number(value);

	if (!Number.isInteger(parsedValue) || parsedValue < 1) {
		throw new Error('Expected a positive integer');
	}

	return parsedValue;
}

function aggregateRuns(adapterRuns: readonly PassRun[]): Aggregate {
	return {
		wallMs: statistics(adapterRuns.map((run) => run.wallMs)),
		coreMs: statistics(adapterRuns.map((run) => run.coreMs)),
		adapterMs: statistics(adapterRuns.map((run) => run.adapterMs)),
		setupMs: statistics(adapterRuns.map((run) => run.setupMs)),
		lexerMs: statistics(adapterRuns.map((run) => run.lexerMs)),
		sllParseMs: statistics(adapterRuns.map((run) => run.sllParseMs)),
		llParseMs: statistics(adapterRuns.map((run) => run.llParseMs)),
		peakRssBytes: statistics(adapterRuns.map((run) => run.peakRssBytes)),
		llFallbackFiles: statistics(adapterRuns.map((run) => run.llFallbackFiles)),
		lexerDiagnostics: statistics(adapterRuns.map((run) => run.lexerDiagnostics)),
		parseDiagnostics: statistics(adapterRuns.map((run) => run.parseDiagnostics)),
	};
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
	campaignSelection: BenchmarkSelection,
	aggregateResults: Readonly<Record<string, Aggregate>>,
	renderedStrata: Readonly<
		Record<
			string,
			readonly Readonly<{ name: string; files: number; minBytes: number; maxBytes: number; coreMs: MetricStatistics; llFallbackFiles: number }>[]
		>
	>,
	passRuns: Readonly<Record<string, readonly PassRun[]>>,
): string {
	const adapterRows = Object.entries(aggregateResults).map(([name, metrics]) => {
		const diagnostics = metrics.lexerDiagnostics.mean + metrics.parseDiagnostics.mean;
		return `| ${name} | ${metrics.wallMs.mean.toFixed(3)} [${metrics.wallMs.meanCi95.lower.toFixed(3)}, ${metrics.wallMs.meanCi95.upper.toFixed(3)}] | ${metrics.wallMs.standardDeviation.toFixed(3)} | ${(metrics.wallMs.coefficientOfVariation * 100).toFixed(2)}% | ${metrics.coreMs.mean.toFixed(3)} [${metrics.coreMs.meanCi95.lower.toFixed(3)}, ${metrics.coreMs.meanCi95.upper.toFixed(3)}] | ${metrics.coreMs.standardDeviation.toFixed(3)} | ${(metrics.coreMs.coefficientOfVariation * 100).toFixed(2)}% | ${formatBytes(metrics.peakRssBytes.max)} | ${metrics.llFallbackFiles.mean.toFixed(1)} | ${diagnostics.toFixed(1)} |`;
	});
	const phaseRows = Object.entries(aggregateResults).map(
		([name, metrics]) =>
			`| ${name} | ${metrics.setupMs.mean.toFixed(3)} | ${metrics.lexerMs.mean.toFixed(3)} | ${metrics.sllParseMs.mean.toFixed(3)} | ${metrics.llParseMs.mean.toFixed(3)} | ${metrics.adapterMs.mean.toFixed(3)} |`,
	);
	const stratumRows = Object.entries(renderedStrata).flatMap(([name, entries]) =>
		entries.map(
			(entry) =>
				`| ${name} | ${entry.name} | ${String(entry.files)} | ${formatBytes(entry.minBytes)}–${formatBytes(entry.maxBytes)} | ${entry.coreMs.mean.toFixed(3)} | ${entry.coreMs.meanCi95.lower.toFixed(3)}–${entry.coreMs.meanCi95.upper.toFixed(3)} | ${(entry.coreMs.coefficientOfVariation * 100).toFixed(2)}% | ${String(entry.llFallbackFiles)} |`,
		),
	);
	const fallbackMax = Math.max(0, ...Object.values(passRuns).flatMap((adapterRuns) => adapterRuns.map((run) => run.llFallbackFiles)));

	return [
		`# ${experimentName}`,
		'',
		`Corpus: ${campaignSelection.corpus.id}; ${campaignSelection.criteria} ${String(campaignSelection.selected.files)} opaque files, ${formatBytes(campaignSelection.selected.bytes)} of ${formatBytes(campaignSelection.population.bytes)}. Three fresh-process cache-reuse passes unless config states otherwise.`,
		'',
		`Selection ${campaignSelection.mode}: fingerprint ${campaignSelection.fingerprint}, source ${campaignSelection.artifact.kind} ${campaignSelection.artifact.path ?? 'in-memory'} (SHA-256 ${campaignSelection.artifact.sha256.slice(0, 16)}…).`,
		'',
		'| Adapter | Wall mean ms [bootstrap 95% CI] | Wall SD | Wall CV | Core mean ms [bootstrap 95% CI] | Core SD | Core CV | Peak RSS max | LL fallback files mean | Diagnostics mean |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...adapterRows,
		'',
		'| Adapter | Setup mean ms | Lexer mean ms | SLL parse mean ms | LL fallback mean ms | Adapter mean ms |',
		'| --- | ---: | ---: | ---: | ---: | ---: |',
		...phaseRows,
		'',
		'| Adapter | Size stratum | Files | Byte range | Core mean ms | Bootstrap 95% CI | Core CV | LL fallback files |',
		'| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		...stratumRows,
		'',
		`Wall time includes child process/container startup and source loading. Core time is lexer plus SLL and LL parsing. Construction is reported in setup and included in adapter time. Peak RSS is the process high-water mark. A fresh process runs each repetition; parser instances are per file while generated lexer/parser DFA caches persist across files. Maximum LL fallback files in any pass: ${String(fallbackMax)}.`,
		'',
		'Selection is tail-biased when mode is `tail` and covers the largest quartile when mode is `q4`; neither estimates the full corpus. Full-corpus validation remains required before accepting a parser optimization.',
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
