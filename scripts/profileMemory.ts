import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import path from 'node:path';
import { javaAdapter, runJavaMemory } from '../src/adapters/java.ts';
import { runTypeScriptMemory, typeScriptAdapter } from '../src/adapters/typescript.ts';
import { loadManifest } from '../src/corpus.ts';
import {
	aggregateMemoryPasses,
	assertPublishable,
	type MemoryPass,
	type MemoryReport,
	profilerOverhead,
	renderMemoryMarkdown,
	type SelectionMemoryReport,
	type TimingPass,
} from '../src/memory.ts';
import { createProgressReporter } from '../src/progress.ts';
import { resolveBenchmarkSelection, type SelectionMode, workspaceRelative } from '../src/selection.ts';
import { type CorpusFile, type ParseObservation } from '../src/types.ts';

const usage = `Usage: pnpm profile:memory [options]

Options:
  --manifest <path>       Corpus manifest (default: .work/private-production/manifest.json)
  --selection <mode>      full, q4, tail, or all (default: all)
  --adapter <name>        typescript, java, or both (default: both)
  --repeats <n>           Instrumented repeats for q4/tail (default: 2)
  --full-repeats <n>      Instrumented repeats for the full corpus (default: 1)
  --gc-every <n>          Files between forced-GC checkpoints (default: 25)
  --experiment <name>     Output directory under results/ (default: memory-profile)
  --no-allocation         Disable allocation sampling
  --publish <dir>         Write a sanitized report under a workspace directory
  --dry-run               Resolve selections without measuring
  --help                  Show this message

Profiling methods:
  Node  Sampling heap profiler and forced-GC retained deltas.
  Java  jcmd class histogram, thread allocated bytes, forced-GC checkpoints.
`;

type AdapterName = 'typescript' | 'java';

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));
const manifestPath = path.resolve(parsed.manifest);
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest } = loadManifest(manifestPath, filesDir);

if (manifest.visibility === 'private') {
	const opaque = /^source-\d{6}\.[a-z0-9]+$/u;

	if (manifest.files.some((file) => !opaque.test(file.path) || file.file !== file.path)) {
		throw new Error('Private manifest contains a non-opaque file identity');
	}
}

const modes: readonly SelectionMode[] = parsed.selection === 'all' ? ['tail', 'q4', 'full'] : [parsed.selection];
const adapterNames: readonly AdapterName[] = parsed.adapter === 'both' ? ['typescript', 'java'] : [parsed.adapter];
const selections = modes.map((mode) =>
	resolveBenchmarkSelection({
		mode,
		manifest,
		manifestPath,
		workspaceRoot: root,
		tailSize: 12,
	}),
);
const rawDir = path.join(root, 'results', parsed.experiment, 'raw');

if (parsed.dryRun) {
	for (const selection of selections) {
		process.stdout.write(
			`${selection.mode}: ${String(selection.selected.files)} files, ${String(selection.selected.minBytes)}–${String(selection.selected.maxBytes)} bytes, fingerprint ${selection.fingerprint}, source ${selection.artifact.kind} ${selection.artifact.path ?? 'in-memory'}\n`,
		);
	}

	process.exit(0);
}

mkdirSync(rawDir, { recursive: true });
const selectionReports: SelectionMemoryReport[] = [];
const totalUnits = selections.reduce(
	(total, selection) => total + adapterNames.length * (2 + (selection.mode === 'full' ? parsed.fullRepeats : parsed.repeats)),
	0,
);
const progress = createProgressReporter({ label: 'memory profile', total: totalUnits, unit: 'passes' });
let completedUnits = 0;

for (const selection of selections) {
	const files = selection.files;
	const indexes = files.map((file) => file.id);
	const repeats = selection.mode === 'full' ? parsed.fullRepeats : parsed.repeats;
	const adapters = [];

	process.stdout.write(`${selection.mode}: ${String(files.length)} files; ${String(repeats)} instrumented repeat(s); ${adapterNames.join(', ')}.\n`);

	for (const name of adapterNames) {
		const adapter = name === 'typescript' ? typeScriptAdapter : javaAdapter;
		const runPass = adapter.runPass;

		if (runPass === undefined) {
			throw new Error(`${name} adapter has no shared corpus pass`);
		}

		process.stdout.write(`${selection.mode}/${name}: uninstrumented timing reference.\n`);
		const observations = await runPass({ manifestPath, filesDir, indexes });
		const timing = summarizeTiming(name, selection.mode, observations, indexes.length);
		const instrumented: MemoryPass[] = [];
		completedUnits += 1;
		progress.advance(completedUnits, `${selection.mode}/${name} timing`);

		for (let repetition = 1; repetition <= repeats; repetition += 1) {
			const prefix = path.join(rawDir, `${selection.mode}-${name}-r${String(repetition)}`);
			const allocationProfilePath = parsed.allocation && name === 'typescript' ? `${prefix}-allocation.heapprofile` : undefined;
			const treeFile = largestFile(files);
			const treePosition = indexes.indexOf(treeFile.id);
			process.stdout.write(`${selection.mode}/${name}: instrumented repeat ${String(repetition)}/${String(repeats)}.\n`);
			const body =
				name === 'typescript'
					? await runTypeScriptMemory({
							manifestPath,
							filesDir,
							indexes,
							gcEvery: parsed.gcEvery,
							allocationProfilePath,
							treeIndex: treeFile.id,
						})
					: await runJavaMemory({ manifestPath, indexes, gcEvery: parsed.gcEvery, treePosition });
			instrumented.push({ ...body, adapter: name, selection: selection.mode, repetition });
			completedUnits += 1;
			progress.advance(completedUnits, `${selection.mode}/${name} repeat ${String(repetition)}/${String(repeats)}`);
		}

		adapters.push({
			adapter: name,
			uninstrumented: timing,
			instrumented,
			aggregate: aggregateMemoryPasses(instrumented),
			overhead: profilerOverhead(timing, instrumented),
		});
	}

	selectionReports.push({
		mode: selection.mode,
		criteria: selection.criteria,
		fingerprint: selection.fingerprint,
		files: selection.selected.files,
		bytes: selection.selected.bytes,
		artifact: { kind: selection.artifact.kind, path: selection.artifact.path, sha256: selection.artifact.sha256 },
		adapters,
	});
}

progress.finish(`${String(selectionReports.length)} selections`);

const report: MemoryReport = {
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
	corpus: { id: manifest.id, sourceFiles: manifest.sourceFiles, sourceBytes: manifest.sourceBytes },
	profilers: {
		'v8-sampling-heap-profiler': ['inspector HeapProfiler sampling', 'interval 32768 bytes', 'allocation volume, not retained bytes'],
		'v8-retained-deltas': ['forced-GC heap deltas', 'DFA table clear and staged reference drop'],
		'jvm-class-histogram': ['jcmd GC.class_histogram -all after forced GC', 'live instances and shallow bytes by class'],
		'jvm-thread-allocation': ['com.sun.management.ThreadMXBean.getCurrentThreadAllocatedBytes', 'cumulative allocated bytes, not retained bytes'],
	},
	selections: selectionReports,
	limitations: [
		'V8 heap snapshots were rejected for this corpus: a 12-file tail snapshot was 2.7 GB and exceeded in-process read limits, so forced-GC byte deltas replace snapshot attribution.',
		'Generic arrays, maps, and runtime internals are not attributed to a parser owner when the profiler does not expose ownership.',
		'Sampling allocation profiles estimate volumes from a sampling interval; they do not enumerate every allocation.',
		'Forced garbage collection changes wall time and must not be compared with production benchmark results.',
		'JVM class histograms describe live objects at one instant; JIT and GC metadata are outside the Java heap histogram.',
		'One representative file isolates parse-tree, source-text, and token-stream retention; it is not a corpus average.',
		'No optimization is proposed from these measurements alone.',
	],
};
const markdown = renderMemoryMarkdown(report);

writeFileSync(path.join(root, 'results', parsed.experiment, 'memory-report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(root, 'results', parsed.experiment, 'memory-report.md'), markdown);
process.stdout.write(`Report: results/${parsed.experiment}/memory-report.md\n`);

if (parsed.publish !== undefined) {
	const publishDir = path.join(root, workspaceRelative(path.resolve(parsed.publish), root));
	const reportPath = path.join(publishDir, 'report.json');

	if (existsSync(reportPath)) {
		throw new Error(`Refusing to overwrite promoted memory report: ${workspaceRelative(reportPath, root)}`);
	}

	const published: MemoryReport = {
		...report,
		selections: report.selections.map((selection) => ({
			...selection,
			artifact:
				selection.artifact.path !== null && selection.artifact.path.startsWith('.work/')
					? { ...selection.artifact, kind: 'private-manifest', path: null }
					: selection.artifact,
		})),
	};
	assertPublishable(published, root);
	mkdirSync(publishDir, { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(published, null, 2)}\n`);
	writeFileSync(path.join(publishDir, 'report.md'), renderMemoryMarkdown(published));
	process.stdout.write(`Published: ${workspaceRelative(publishDir, root)}/report.md\n`);
}

function summarizeTiming(adapter: string, selection: string, observations: ReadonlyMap<string, ParseObservation>, expected: number): TimingPass {
	const values = [...observations.values()];

	if (values.length !== expected) {
		throw new Error(`${adapter} measured ${String(values.length)} of ${String(expected)} files`);
	}

	return {
		adapter,
		selection,
		repetition: 1,
		files: values.length,
		coreMs: values.reduce((total, observation) => total + observation.coreMs, 0),
		elapsedMs: values.reduce((total, observation) => total + observation.adapterMs, 0),
		peakRssBytes: Math.max(...values.map((observation) => observation.peakRssBytes)),
	};
}

function largestFile(files: readonly CorpusFile[]): CorpusFile {
	const largest = [...files].sort((left, right) => right.bytes - left.bytes || left.id - right.id)[0];

	if (largest === undefined) {
		throw new Error('Selection has no files');
	}

	return largest;
}

function parseArguments(args: readonly string[]): Readonly<{
	manifest: string;
	selection: SelectionMode | 'all';
	adapter: AdapterName | 'both';
	repeats: number;
	fullRepeats: number;
	gcEvery: number;
	experiment: string;
	allocation: boolean;
	publish: string | undefined;
	dryRun: boolean;
}> {
	let manifestValue = path.join(root, '.work', 'private-production', 'manifest.json');
	let selection: SelectionMode | 'all' = 'all';
	let adapter: AdapterName | 'both' = 'both';
	let repeats = 2;
	let fullRepeats = 1;
	let gcEvery = 25;
	let experiment = 'memory-profile';
	let allocation = true;
	let publish: string | undefined;
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

		if (argument === '--') {
			continue;
		}

		if (argument === '--no-allocation') {
			allocation = false;
			continue;
		}

		if (argument === '--dry-run') {
			dryRun = true;
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
			case '--selection': {
				if (value !== 'full' && value !== 'q4' && value !== 'tail' && value !== 'all') {
					throw new Error('--selection must be full, q4, tail, or all');
				}

				selection = value;
				break;
			}
			case '--adapter': {
				if (value !== 'typescript' && value !== 'java' && value !== 'both') {
					throw new Error('--adapter must be typescript, java, or both');
				}

				adapter = value;
				break;
			}
			case '--repeats': {
				repeats = positiveInteger(value);
				break;
			}
			case '--full-repeats': {
				fullRepeats = positiveInteger(value);
				break;
			}
			case '--gc-every': {
				gcEvery = positiveInteger(value);
				break;
			}
			case '--experiment': {
				experiment = value;
				break;
			}
			case '--publish': {
				publish = value;
				break;
			}
			default: {
				throw new Error(`Unknown argument: ${argument}`);
			}
		}

		index += 1;
	}

	return { manifest: manifestValue, selection, adapter, repeats, fullRepeats, gcEvery, experiment, allocation, publish, dryRun };
}

function positiveInteger(value: string): number {
	const parsedValue = Number(value);

	if (!Number.isInteger(parsedValue) || parsedValue < 1) {
		throw new Error('Expected a positive integer');
	}

	return parsedValue;
}
