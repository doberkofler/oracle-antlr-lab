import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest } from '../src/corpus.ts';
import { resolveBenchmarkSelection, type SelectionMode } from '../src/selection.ts';
import { statistics } from '../src/stats.ts';
import { type CorpusFile, type MetricStatistics } from '../src/types.ts';
import { type GrammarBenchmarkObservation } from '../grammar/typescript/grammarBenchmarkTypes.ts';
import { defaultStateRoot, readGrammarStates, readGrammarStateLock, stateByKey } from './grammarStateSource.ts';
import { prepareGrammarStates } from './grammarStatePreparation.ts';

const usage = `Usage: pnpm benchmark:grammar [options]

Options:
  --manifest <path>          Corpus manifest (default: .work/private-production/manifest.json)
  --states <keys>            Control plus candidates, comma-separated (default: control,pr-5132,cumulative)
  --selection <mode>         full, q4, or tail (default: full)
  --tail-size <n>            Tail file count (default: 12)
  --selection-source <path>  Audited report that justifies q4/tail (default: experiment 003/004)
  --repeats <n>              Fresh-process repetitions per state (default: 3)
  --experiment <name>        Result directory name (default: upstream-grammar-benchmark)
  --state-root <path>        Grammar-state directory (default: .work/grammar-states)
  --regenerate               Regenerate every parser even when its marker matches
  --dry-run                  Resolve the selection without running a campaign
  --help                     Show this message
`;

type ParsedArguments = Readonly<{
	manifest: string;
	states: readonly string[];
	selection: SelectionMode;
	tailSize: number;
	selectionSource: string | undefined;
	repeats: number;
	experiment: string;
	stateRoot: string;
	regenerate: boolean;
	dryRun: boolean;
}>;

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
	llFallbackFiles: number;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	observations: ReadonlyMap<string, GrammarBenchmarkObservation>;
}>;

type StateResult = Readonly<{
	key: string;
	title: string;
	ref: string | null;
	pullRequest: number | null;
	digests: Readonly<Record<string, string>>;
	runs: readonly PassRun[];
}>;

type PairedResult = Readonly<{
	candidate: string;
	controlCoreMs: MetricStatistics;
	candidateCoreMs: MetricStatistics;
	pairedDeltaMs: MetricStatistics;
	deltaPercent: number;
	perFileDeltaMs: MetricStatistics;
	claim: 'improvement' | 'regression' | 'no-change';
	fallbacks: Readonly<{ control: number; candidate: number }>;
	largestImprovements: readonly Readonly<{ file: string; bytes: number; deltaMs: number }>[];
	largestRegressions: readonly Readonly<{ file: string; bytes: number; deltaMs: number }>[];
}>;

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));
const manifestPath = path.resolve(parsed.manifest);
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
	process.stdout.write(`${selection.mode}: ${String(files.length)} files, fingerprint ${selection.fingerprint}\nStates: ${parsed.states.join(', ')}\n`);
	process.exit(0);
}

const statesManifest = readGrammarStates(root);
const lock = readGrammarStateLock(root);

if (lock === undefined) {
	throw new Error('grammar/states.lock.json is required; run pnpm grammar:states');
}

const [controlKey, ...candidateKeys] = parsed.states;

if (controlKey === undefined || candidateKeys.length === 0) {
	throw new Error('--states requires a control and at least one candidate');
}

const stateDefinitions = [controlKey, ...candidateKeys].map((key) => stateByKey(statesManifest, key));
const prepared = await prepareGrammarStates({
	root,
	manifest: statesManifest,
	lock,
	states: stateDefinitions,
	stateRoot: path.resolve(parsed.stateRoot),
	regenerate: parsed.regenerate,
});
const indexes = files.map((file) => file.id);
const results: StateResult[] = [];

for (const state of prepared) {
	process.stdout.write(`Benchmarking ${state.materialized.definition.key} over ${String(files.length)} files.\n`);
	const runs: PassRun[] = [];

	for (let repeat = 1; repeat <= parsed.repeats; repeat += 1) {
		const startedAt = performance.now();
		const observations = runPass(state.materialized.definition.key, state.generatedDirectory, manifestPath, filesDir, indexes);
		const wallMs = performance.now() - startedAt;
		const ordered = files.map((file) => {
			const observation = observations.get(file.path);

			if (observation === undefined) {
				throw new Error(`${state.materialized.definition.key} omitted ${file.path}`);
			}

			return observation;
		});
		const run: PassRun = {
			repeat,
			wallMs,
			coreMs: sum(ordered, (observation) => observation.coreMs),
			adapterMs: sum(ordered, (observation) => observation.adapterMs),
			setupMs: sum(ordered, (observation) => observation.phases.setupMs),
			lexerMs: sum(ordered, (observation) => observation.phases.lexerMs),
			sllParseMs: sum(ordered, (observation) => observation.phases.sllParseMs),
			llParseMs: sum(ordered, (observation) => observation.phases.llParseMs),
			peakRssBytes: Math.max(...ordered.map((observation) => observation.peakRssBytes)),
			llFallbackFiles: ordered.filter((observation) => observation.llAttempts > 0).length,
			lexerDiagnostics: sum(ordered, (observation) => observation.lexerDiagnostics),
			parseDiagnostics: sum(ordered, (observation) => observation.parseDiagnostics),
			observations,
		};
		runs.push(run);
		process.stdout.write(
			`${state.materialized.definition.key} ${String(repeat)}/${String(parsed.repeats)}: core ${run.coreMs.toFixed(1)} ms, wall ${formatDuration(wallMs)}, fallback ${String(run.llFallbackFiles)} files, peak RSS ${formatBytes(run.peakRssBytes)}.\n`,
		);
	}

	results.push({
		key: state.materialized.definition.key,
		title: state.materialized.definition.title,
		ref: state.materialized.definition.ref ?? null,
		pullRequest: state.materialized.definition.pullRequest ?? null,
		digests: { ...state.materialized.digests.adapted },
		runs,
	});
}

const control = results[0];

if (control === undefined) {
	throw new Error('No control result');
}

const paired = results.slice(1).map((candidate) => pairResults(control, candidate, files));
const report = {
	schemaVersion: 1,
	experiment: parsed.experiment,
	generatedAt: new Date().toISOString(),
	environment: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		release: release(),
		cpuModel: cpus()[0]?.model ?? 'unknown',
		logicalCpus: cpus().length,
		totalMemoryBytes: totalmem(),
	},
	selection,
	config: {
		repeats: parsed.repeats,
		pass: 'one fresh process per repetition; generated DFA caches persist across files within a repetition',
		errorListener: 'silent collector; SLL-first with LL fallback on the first parser diagnostic',
	},
	states: results.map(({ runs: stateRuns, ...state }) => ({
		...state,
		runs: stateRuns.map(({ observations: _observations, ...run }) => run),
	})),
	paired,
};

const output = path.join(root, 'results', parsed.experiment);
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(output, 'report.md'), renderMarkdown(report));
process.stdout.write(`Reports: ${path.relative(root, output)}/report.md and report.json\n`);

function pairResults(controlState: StateResult, candidateState: StateResult, selected: readonly CorpusFile[]): PairedResult {
	const pairedTotals: number[] = [];

	for (const [index, controlRun] of controlState.runs.entries()) {
		const candidateRun = candidateState.runs[index];

		if (candidateRun === undefined) {
			throw new Error(`Candidate ${candidateState.key} is missing repetition ${String(index + 1)}`);
		}

		pairedTotals.push(candidateRun.coreMs - controlRun.coreMs);
	}

	const controlTotals = controlState.runs.map((run) => run.coreMs);
	const candidateTotals = candidateState.runs.map((run) => run.coreMs);
	const controlCore = statistics(controlTotals);
	const candidateCore = statistics(candidateTotals);
	const delta = statistics(pairedTotals);
	const controlSign = (pairedTotals[0] ?? 0) < 0;
	const identicalDirection = pairedTotals.every((value) => value < 0 === controlSign);
	const meaningful = Math.abs(delta.mean) >= controlCore.mean * 0.01;
	const claim =
		identicalDirection && meaningful && delta.meanCi95.lower > 0
			? 'regression'
			: identicalDirection && meaningful && delta.meanCi95.upper < 0
				? 'improvement'
				: 'no-change';
	const perFileDelta = selected.map((file) => {
		const controlObservations = controlState.runs.map((run) => run.observations.get(file.path)?.coreMs ?? 0);
		const candidateObservations = candidateState.runs.map((run) => run.observations.get(file.path)?.coreMs ?? 0);
		const controlMedian = statistics(controlObservations).p50;
		const candidateMedian = statistics(candidateObservations).p50;

		return { file: file.path, bytes: file.bytes, deltaMs: candidateMedian - controlMedian };
	});
	const orderedDeltas = [...perFileDelta].sort((left, right) => left.deltaMs - right.deltaMs);

	return {
		candidate: candidateState.key,
		controlCoreMs: controlCore,
		candidateCoreMs: candidateCore,
		pairedDeltaMs: delta,
		deltaPercent: (delta.mean / controlCore.mean) * 100,
		perFileDeltaMs: statistics(perFileDelta.map((entry) => entry.deltaMs)),
		claim,
		fallbacks: {
			control: Math.max(...controlState.runs.map((run) => run.llFallbackFiles)),
			candidate: Math.max(...candidateState.runs.map((run) => run.llFallbackFiles)),
		},
		largestImprovements: orderedDeltas.slice(0, 10),
		largestRegressions: orderedDeltas.slice(-10).reverse(),
	};
}

function runPass(
	key: string,
	generatedDirectory: string,
	corpusManifest: string,
	corpusFiles: string,
	ids: readonly number[],
): ReadonlyMap<string, GrammarBenchmarkObservation> {
	const result = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(root, 'grammar', 'typescript', 'grammarBenchmarkHarness.ts')], {
		cwd: root,
		env: {
			...process.env,
			LAB_MANIFEST: corpusManifest,
			LAB_FILES: corpusFiles,
			LAB_GENERATED_PARSER_DIR: generatedDirectory,
			LAB_STATE: key,
			LAB_IDS: ids.join(','),
		},
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});

	if (result.status !== 0) {
		throw new Error(`Benchmark pass ${key} failed:\n${result.stderr}`);
	}

	const start = result.stdout.indexOf('{');

	if (start < 0) {
		throw new Error(`Benchmark pass ${key} produced no JSON`);
	}

	const parsedOutput: unknown = JSON.parse(result.stdout.slice(start));

	if (typeof parsedOutput !== 'object' || parsedOutput === null || !('files' in parsedOutput) || !Array.isArray(parsedOutput.files)) {
		throw new Error(`Benchmark pass ${key} produced an invalid observation set`);
	}

	const observations = parsedOutput.files.map((file: unknown) => observationOf(file, key));

	return new Map(observations.map((observation) => [observation.file, observation]));
}

function observationOf(value: unknown, key: string): GrammarBenchmarkObservation {
	if (typeof value !== 'object' || value === null) {
		throw new Error(`Benchmark pass ${key} contains a non-object observation`);
	}

	const phases = Reflect.get(value, 'phases');

	if (typeof phases !== 'object' || phases === null) {
		throw new Error(`Benchmark pass ${key} contains an observation without phases`);
	}

	return {
		file: String(Reflect.get(value, 'file')),
		bytes: Number(Reflect.get(value, 'bytes')),
		coreMs: Number(Reflect.get(value, 'coreMs')),
		adapterMs: Number(Reflect.get(value, 'adapterMs')),
		phases: {
			conditionalMs: Number(Reflect.get(phases, 'conditionalMs')),
			setupMs: Number(Reflect.get(phases, 'setupMs')),
			lexerMs: Number(Reflect.get(phases, 'lexerMs')),
			sllParseMs: Number(Reflect.get(phases, 'sllParseMs')),
			llParseMs: Number(Reflect.get(phases, 'llParseMs')),
			totalMs: Number(Reflect.get(phases, 'totalMs')),
		},
		lexerDiagnostics: Number(Reflect.get(value, 'lexerDiagnostics')),
		parseDiagnostics: Number(Reflect.get(value, 'parseDiagnostics')),
		tokens: Number(Reflect.get(value, 'tokens')),
		hiddenTokens: Number(Reflect.get(value, 'hiddenTokens')),
		prediction: Reflect.get(value, 'prediction') === 'sll-fallback-ll' ? 'sll-fallback-ll' : 'sll',
		llAttempts: Number(Reflect.get(value, 'llAttempts')),
		peakRssBytes: Number(Reflect.get(value, 'peakRssBytes')),
	};
}

function sum(observations: readonly GrammarBenchmarkObservation[], selector: (observation: GrammarBenchmarkObservation) => number): number {
	return observations.reduce((total, observation) => total + selector(observation), 0);
}

function parseArguments(args: readonly string[]): ParsedArguments {
	let manifestValue = path.join(root, '.work', 'private-production', 'manifest.json');
	let states = 'control,pr-5132,cumulative';
	let selectionMode: SelectionMode = 'full';
	let tailSize = 12;
	let selectionSource: string | undefined;
	let repeats = 3;
	let experiment = 'upstream-grammar-benchmark';
	let stateRoot = defaultStateRoot(root);
	let regenerate = false;
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

		if (argument === '--regenerate') {
			regenerate = true;
			continue;
		}

		if (argument === '--dry-run') {
			dryRun = true;
			continue;
		}

		if (argument === '--') {
			continue;
		}

		const value = args[index + 1];

		if (value === undefined) {
			throw new Error(`Missing value for ${argument}`);
		}

		switch (argument) {
			case '--manifest': {
				manifestValue = path.resolve(root, value);
				break;
			}
			case '--states': {
				states = value;
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
			case '--repeats': {
				repeats = positiveInteger(value);
				break;
			}
			case '--experiment': {
				experiment = value;
				break;
			}
			case '--state-root': {
				stateRoot = path.resolve(root, value);
				break;
			}
			default: {
				throw new Error(`Unknown argument: ${argument}`);
			}
		}

		index += 1;
	}

	return {
		manifest: manifestValue,
		states: states.split(',').map((key) => key.trim()),
		selection: selectionMode,
		tailSize,
		selectionSource,
		repeats,
		experiment,
		stateRoot,
		regenerate,
		dryRun,
	};
}

function positiveInteger(value: string): number {
	const parsedValue = Number(value);

	if (!Number.isInteger(parsedValue) || parsedValue < 1) {
		throw new Error('Expected a positive integer');
	}

	return parsedValue;
}

type PublishedState = Omit<StateResult, 'runs'> &
	Readonly<{
		runs: readonly Readonly<{
			wallMs: number;
			coreMs: number;
			peakRssBytes: number;
			llFallbackFiles: number;
		}>[];
	}>;

function renderMarkdown(
	value: Readonly<{
		experiment: string;
		selection: { mode: string; criteria: string; fingerprint: string; files: readonly CorpusFile[] };
		states: readonly PublishedState[];
		paired: readonly PairedResult[];
		config: Readonly<{ repeats: number }>;
	}>,
): string {
	const stateRows = value.states.map((state) => {
		const cores = statistics(state.runs.map((run) => run.coreMs));
		const walls = statistics(state.runs.map((run) => run.wallMs));
		const rss = Math.max(...state.runs.map((run) => run.peakRssBytes));
		const fallback = Math.max(...state.runs.map((run) => run.llFallbackFiles));
		return `| ${state.key} | ${state.pullRequest === null ? '—' : `#${String(state.pullRequest)}`} | ${cores.p50.toFixed(1)} | ${cores.meanCi95.lower.toFixed(1)}–${cores.meanCi95.upper.toFixed(1)} | ${(cores.coefficientOfVariation * 100).toFixed(2)}% | ${walls.p50.toFixed(0)} | ${fallback} | ${formatBytes(rss)} |`;
	});
	const pairedRows = value.paired.map(
		(entry) =>
			`| ${entry.candidate} | ${entry.controlCoreMs.p50.toFixed(1)} | ${entry.candidateCoreMs.p50.toFixed(1)} | ${entry.pairedDeltaMs.mean.toFixed(1)} (${entry.deltaPercent.toFixed(2)}%) | ${entry.pairedDeltaMs.meanCi95.lower.toFixed(1)}–${entry.pairedDeltaMs.meanCi95.upper.toFixed(1)} | ${entry.claim} |`,
	);

	return [
		`# ${value.experiment}`,
		'',
		`Selection: ${value.selection.mode}; ${value.selection.criteria}.`,
		`Fingerprint: \`${value.selection.fingerprint}\`; ${String(value.selection.files.length)} files.`,
		'',
		`Repetitions per state: ${String(value.config.repeats)}; one fresh Node.js process per repetition.`,
		'',
		'| State | Pull request | Parser core p50 (ms) | 95% CI (ms) | CV | Wall p50 (ms) | Fallback files | Peak RSS |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...stateRows,
		'',
		'## Paired comparison',
		'',
		'| Candidate | Control p50 (ms) | Candidate p50 (ms) | Paired delta mean (relative) | 95% CI (ms) | Claim |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
		...pairedRows,
		'',
		'A change is claimed only when every repetition moves in the same direction, the paired mean differs from zero at a 95% confidence level, and the difference is at least 1% of the control parser core.',
		'',
	].join('\n');
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1_000) {
		return `${String(bytes)} B`;
	}

	if (bytes < 1_000_000) {
		return `${(bytes / 1_000).toFixed(1)} kB`;
	}

	if (bytes < 1_000_000_000) {
		return `${(bytes / 1_000_000).toFixed(1)} MB`;
	}

	return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
