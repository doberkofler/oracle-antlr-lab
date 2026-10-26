import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compareReports, type ProductionPassRun, type ProductionReport, type ReportEnvironment, renderComparisonMarkdown } from '../src/comparison.ts';
import { type BenchmarkSelection, workspaceRelative } from '../src/selection.ts';
import { type CorpusFile, type ParseObservation } from '../src/types.ts';

const usage = `Usage: pnpm benchmark:compare -- --control <report> --candidate <report> [options]

Options:
  --control <path>    Control raw-report.json or report.json
  --candidate <path>  Candidate raw-report.json or report.json
  --experiment <name> Output directory under results/ (default: comparison)
  --help              Show this message

Paired per-file deltas require raw-report.json. Published report.json files
support aggregate comparison only.
`;

const root = path.resolve(import.meta.dirname, '..');
const options = parseArguments(process.argv.slice(2));
const controlPath = path.resolve(options.control);
const candidatePath = path.resolve(options.candidate);
const control = parseProductionReport(readFileSync(controlPath, 'utf8'), 'control');
const candidate = parseProductionReport(readFileSync(candidatePath, 'utf8'), 'candidate');
const comparison = compareReports({
	experiment: options.experiment,
	controlArtifact: workspaceRelative(controlPath, root),
	candidateArtifact: workspaceRelative(candidatePath, root),
	control,
	candidate,
});
const output = path.join(root, 'results', options.experiment);

mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`);
writeFileSync(path.join(output, 'comparison.md'), renderComparisonMarkdown(comparison));

for (const [name, adapter] of Object.entries(comparison.adapters)) {
	const paired = adapter.paired;
	process.stdout.write(
		`${name}: core ${adapter.control.coreMs.mean.toFixed(3)} → ${adapter.candidate.coreMs.mean.toFixed(3)} ms (${adapter.changePercent.coreMs.toFixed(2)}%)` +
			(paired === null
				? '\n'
				: `; paired delta ${paired.coreMs.mean.toFixed(3)} ms [${paired.coreMs.meanCi95.lower.toFixed(3)}, ${paired.coreMs.meanCi95.upper.toFixed(3)}]\n`),
	);
}

process.stdout.write(`Comparison: ${path.relative(root, output)}/comparison.md\n`);

function parseArguments(args: readonly string[]): Readonly<{ control: string; candidate: string; experiment: string }> {
	let controlArgument: string | undefined;
	let candidateArgument: string | undefined;
	let experiment = 'comparison';

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument === undefined) {
			throw new Error('Missing argument');
		}

		if (argument === '--help') {
			process.stdout.write(usage);
			process.exit(0);
		}

		const value = args[index + 1];

		if (value === undefined) {
			throw new Error(`Missing value for ${argument}`);
		}

		switch (argument) {
			case '--control': {
				controlArgument = value;
				break;
			}
			case '--candidate': {
				candidateArgument = value;
				break;
			}
			case '--experiment': {
				experiment = value;
				break;
			}
			default: {
				throw new Error(`Unknown argument: ${argument}`);
			}
		}

		index += 1;
	}

	if (controlArgument === undefined || candidateArgument === undefined) {
		throw new Error('--control and --candidate are required');
	}

	return { control: controlArgument, candidate: candidateArgument, experiment };
}

function parseProductionReport(text: string, label: string): ProductionReport {
	const document = recordValue(JSON.parse(text), label);
	const corpus = recordValue(document['corpus'], `${label}.corpus`);
	const selection = document['selection'] === undefined ? null : parseSelection(document['selection'], `${label}.selection`);

	return {
		experiment: stringField(document, 'experiment', label),
		generatedAt: stringField(document, 'generatedAt', label),
		environment: document['environment'] === undefined ? null : parseEnvironment(document['environment'], `${label}.environment`),
		corpus: {
			id: stringField(corpus, 'id', `${label}.corpus`),
			sourceFiles: numberField(corpus, 'sourceFiles', `${label}.corpus`),
			sourceBytes: numberField(corpus, 'sourceBytes', `${label}.corpus`),
			selection: stringField(corpus, 'selection', `${label}.corpus`),
			files: arrayValue(corpus['files'], `${label}.corpus.files`).map((entry, index) =>
				parseCorpusFile(entry, `${label}.corpus.files[${String(index)}]`),
			),
		},
		selection,
		adapters: [],
		runs: parseRuns(document['runs'], `${label}.runs`),
	};
}

function parseSelection(value: unknown, label: string): BenchmarkSelection {
	const record = recordValue(value, label);
	const corpus = recordValue(record['corpus'], `${label}.corpus`);
	const artifact = recordValue(record['artifact'], `${label}.artifact`);
	const population = recordValue(record['population'], `${label}.population`);
	const selected = recordValue(record['selected'], `${label}.selected`);
	const mode = stringField(record, 'mode', label);

	if (mode !== 'full' && mode !== 'q4' && mode !== 'tail') {
		throw new Error(`${label}.mode must be full, q4, or tail`);
	}

	return {
		schemaVersion: 1,
		mode,
		criteria: stringField(record, 'criteria', label),
		corpus: {
			id: stringField(corpus, 'id', `${label}.corpus`),
			sourceFiles: numberField(corpus, 'sourceFiles', `${label}.corpus`),
			sourceBytes: numberField(corpus, 'sourceBytes', `${label}.corpus`),
		},
		artifact: {
			kind: stringField(artifact, 'kind', `${label}.artifact`) === 'report' ? 'report' : 'manifest',
			path: typeof artifact['path'] === 'string' ? artifact['path'] : null,
			sha256: stringField(artifact, 'sha256', `${label}.artifact`),
			experiment: typeof artifact['experiment'] === 'string' ? artifact['experiment'] : null,
			selection: typeof artifact['selection'] === 'string' ? artifact['selection'] : null,
		},
		population: {
			files: numberField(population, 'files', `${label}.population`),
			bytes: numberField(population, 'bytes', `${label}.population`),
		},
		selected: {
			files: numberField(selected, 'files', `${label}.selected`),
			bytes: numberField(selected, 'bytes', `${label}.selected`),
			minBytes: numberField(selected, 'minBytes', `${label}.selected`),
			maxBytes: numberField(selected, 'maxBytes', `${label}.selected`),
		},
		fingerprint: stringField(record, 'fingerprint', label),
		files: arrayValue(record['files'], `${label}.files`).map((entry, index) => parseCorpusFile(entry, `${label}.files[${String(index)}]`)),
		ranking: null,
	};
}

function parseRuns(value: unknown, label: string): Readonly<Record<string, readonly ProductionPassRun[]>> {
	const runs = recordValue(value, label);

	return Object.fromEntries(
		Object.entries(runs).map(([name, entries]) => [
			name,
			arrayValue(entries, `${label}.${name}`).map((entry, index) => parsePassRun(entry, `${label}.${name}[${String(index)}]`)),
		]),
	);
}

function parsePassRun(value: unknown, label: string): ProductionPassRun {
	const record = recordValue(value, label);

	return {
		repeat: numberField(record, 'repeat', label),
		wallMs: numberField(record, 'wallMs', label),
		coreMs: numberField(record, 'coreMs', label),
		adapterMs: numberField(record, 'adapterMs', label),
		setupMs: numberField(record, 'setupMs', label),
		lexerMs: numberField(record, 'lexerMs', label),
		sllParseMs: numberField(record, 'sllParseMs', label),
		llParseMs: numberField(record, 'llParseMs', label),
		peakRssBytes: numberField(record, 'peakRssBytes', label),
		lexerDiagnostics: numberField(record, 'lexerDiagnostics', label),
		parseDiagnostics: numberField(record, 'parseDiagnostics', label),
		llFallbackFiles: numberField(record, 'llFallbackFiles', label),
		files:
			record['files'] === undefined
				? null
				: arrayValue(record['files'], `${label}.files`).map((entry, index) => parseObservation(entry, `${label}.files[${String(index)}]`)),
	};
}

function parseObservation(value: unknown, label: string): ParseObservation {
	const record = recordValue(value, label);
	const phases = recordValue(record['phases'], `${label}.phases`);
	const prediction = stringField(record, 'prediction', label);

	if (prediction !== 'sll' && prediction !== 'sll-fallback-ll' && prediction !== 'll' && prediction !== 'unknown') {
		throw new Error(`${label}.prediction is invalid`);
	}

	return {
		file: stringField(record, 'file', label),
		coreMs: numberField(record, 'coreMs', label),
		adapterMs: numberField(record, 'adapterMs', label),
		phases: Object.fromEntries(Object.entries(phases).map(([name, phase]) => [name, numberValue(phase, `${label}.phases.${name}`)])),
		lexerDiagnostics: numberField(record, 'lexerDiagnostics', label),
		parseDiagnostics: numberField(record, 'parseDiagnostics', label),
		tokens: numberField(record, 'tokens', label),
		hiddenTokens: numberField(record, 'hiddenTokens', label),
		prediction,
		sllAttempts: numberField(record, 'sllAttempts', label),
		llAttempts: numberField(record, 'llAttempts', label),
		peakRssBytes: numberField(record, 'peakRssBytes', label),
	};
}

function parseCorpusFile(value: unknown, label: string): CorpusFile {
	const record = recordValue(value, label);

	return {
		id: numberField(record, 'id', label),
		path: stringField(record, 'path', label),
		file: stringField(record, 'file', label),
		bytes: numberField(record, 'bytes', label),
		lines: numberField(record, 'lines', label),
		sha256: stringField(record, 'sha256', label),
	};
}

function parseEnvironment(value: unknown, label: string): ReportEnvironment {
	const record = recordValue(value, label);

	return {
		node: stringField(record, 'node', label),
		platform: stringField(record, 'platform', label),
		arch: stringField(record, 'arch', label),
		release: stringField(record, 'release', label),
		cpuModel: stringField(record, 'cpuModel', label),
		logicalCpus: numberField(record, 'logicalCpus', label),
		totalMemoryBytes: numberField(record, 'totalMemoryBytes', label),
	};
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}

	return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}

	return value;
}

function numberValue(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${label} must be a finite number`);
	}

	return value;
}

function numberField(record: Readonly<Record<string, unknown>>, field: string, label: string): number {
	return numberValue(record[field], `${label}.${field}`);
}

function stringField(record: Readonly<Record<string, unknown>>, field: string, label: string): string {
	const value = record[field];

	if (typeof value !== 'string' || value === '') {
		throw new Error(`${label}.${field} must be a non-empty string`);
	}

	return value;
}
