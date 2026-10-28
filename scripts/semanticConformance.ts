import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CONFORMANCE_CHANGE_SETS, type ConformanceChangeSet } from '../src/conformanceChanges.ts';
import {
	assertOpaqueIdentities,
	type ConformanceClassification,
	type ConformanceComparison,
	CONFORMANCE_FIELDS,
	type ConformanceField,
	type ConformanceObservation,
	type ConformancePolicy,
	compareConformance,
	FALLBACK_REMOVAL_POLICY,
} from '../src/conformance.ts';
import { loadManifest } from '../src/corpus.ts';
import { type GeneratedParserOptimization } from '../src/generatedParserOptimization.ts';
import { createProgressReporter, formatDuration } from '../src/progress.ts';

const usage = `Usage: pnpm conformance [options]

Options:
  --manifest <path>       Corpus manifest (default: .work/private-production/manifest.json)
  --experiment <name>     Result directory name (default: semantic-conformance)
  --change-set <id>       all, or one/named comma-separated gate ids (default: all)
  --ids <n,n>             Optional corpus id subset for a smoke run
  --publish <path>        Write conformance.json and conformance.md to this directory
  --state-root <path>     Generated-state directory (default: .work/conformance/<experiment>)
  --dry-run               Print the gates and generated states without running
  --help                  Show this message
`;

type ParsedArguments = Readonly<{
	manifest: string;
	experiment: string;
	changeSets: readonly ConformanceChangeSet[];
	ids: readonly number[] | undefined;
	publish: string | undefined;
	stateRoot: string | undefined;
	dryRun: boolean;
}>;

type PreparedState = Readonly<{
	key: string;
	optimizations: readonly GeneratedParserOptimization[];
	generatedDirectory: string;
}>;

type GateEvidence = Readonly<{
	file: string;
	bytes: number;
	sha256: string;
	classification: 'intended' | 'unsupported' | 'defect';
	changedFields: readonly string[];
	reason?: string;
	control: ConformanceObservation;
	candidate: ConformanceObservation;
}>;

type GateArtifact = Readonly<{
	id: string;
	issue: number;
	experiment: string;
	title: string;
	control: Readonly<{ state: string; optimizations: readonly GeneratedParserOptimization[] }>;
	candidate: Readonly<{ state: string; optimizations: readonly GeneratedParserOptimization[] }>;
	command: Readonly<{ control: string; candidate: string; compare: string }>;
	policy: string;
	intended: Readonly<{ fields: readonly string[]; reason: string }> | null;
	unsupported: Readonly<{ files: readonly string[]; reason: string }> | null;
	status: 'pass' | 'fail';
	comparedFiles: number;
	evidenceSha256: string;
	differences: Readonly<Record<ConformanceField, number>>;
	classifications: Readonly<Record<ConformanceClassification, number>>;
	totals: ConformanceComparison['totals'];
	changedFiles: readonly GateEvidence[];
}>;

type ConformanceArtifact = Readonly<{
	schemaVersion: 1;
	experiment: string;
	generatedAt: string;
	corpus: Readonly<{ id: string; visibility: string; files: number; sourceBytes: number; selection: string }>;
	oracle: Readonly<Record<string, unknown>>;
	runtimeBoundary: Readonly<Record<string, string>>;
	status: 'pass' | 'fail';
	gates: readonly GateArtifact[];
}>;

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));
const manifestPath = path.resolve(parsed.manifest);
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files: population } = loadManifest(manifestPath, filesDir);
const selected = parsed.ids === undefined ? population : population.filter((file) => parsed.ids?.includes(file.id) ?? false);

if (selected.length === 0) {
	throw new Error('No corpus files selected for conformance');
}

assertOpaqueIdentities(manifest.visibility, selected);

const stateRoot = path.resolve(parsed.stateRoot ?? path.join(root, '.work', 'conformance', parsed.experiment));
const states = collectStates(parsed.changeSets);

if (parsed.dryRun) {
	process.stdout.write(
		`${parsed.changeSets.map((change) => `${change.id}: ${formatOptimizations(change.control)} -> ${formatOptimizations(change.candidate)}`).join('\n')}\nStates: ${states.map((state) => state.key).join(', ')}\n`,
	);
	process.exit(0);
}

const observations = new Map<string, readonly ConformanceObservation[]>();
const progress = createProgressReporter({ label: 'conformance', total: states.length * selected.length, unit: 'files' });

for (const [stateIndex, state] of states.entries()) {
	process.stdout.write(`Preparing generated parser state ${state.key}.\n`);
	const prepareStartedAt = performance.now();
	prepareState(state);
	process.stdout.write(`Prepared ${state.key} in ${formatDuration(performance.now() - prepareStartedAt)}.\n`);
	process.stdout.write(`Running conformance pass for ${state.key} over ${String(selected.length)} files.\n`);
	observations.set(
		state.key,
		await runState(state, (completed) => {
			progress.advance(stateIndex * selected.length + completed, state.key);
		}),
	);
}

progress.finish(`${String(states.length)} states`);

const gates = parsed.changeSets.map((change) => {
	const control = observations.get(stateKey(change.control));
	const candidate = observations.get(stateKey(change.candidate));

	if (control === undefined || candidate === undefined) {
		throw new Error(`Missing conformance pass for ${change.id}`);
	}

	const policy: ConformancePolicy = change.policy === 'fallback-removal' ? FALLBACK_REMOVAL_POLICY : {};
	const comparison = compareConformance(control, candidate, policy);
	const evidence: GateEvidence[] = comparison.files
		.filter((file) => file.classification !== 'identical')
		.map((file) => ({
			file: file.file,
			bytes: file.bytes,
			sha256: file.sha256,
			classification: file.classification === 'identical' ? 'defect' : file.classification,
			changedFields: file.changedFields,
			...(file.reason === undefined ? {} : { reason: file.reason }),
			control: file.control,
			candidate: file.candidate,
		}));

	process.stdout.write(
		`${change.id}: ${comparison.status}; ${String(comparison.classifications.identical)} identical, ${String(comparison.classifications.intended)} intended, ${String(comparison.classifications.unsupported)} unsupported, ${String(comparison.classifications.defect)} defect.\n`,
	);

	return {
		id: change.id,
		issue: change.issue,
		experiment: change.experiment,
		title: change.title,
		control: { state: stateKey(change.control), optimizations: change.control },
		candidate: { state: stateKey(change.candidate), optimizations: change.candidate },
		command: {
			control: generatedStateCommand(change.control),
			candidate: generatedStateCommand(change.candidate),
			compare: 'node scripts/semanticConformance.ts --manifest <manifest> --change-set <id>',
		},
		policy: change.policy,
		intended: policy.intended === undefined ? null : { fields: policy.intended.fields, reason: policy.intended.reason },
		unsupported: policy.unsupported === undefined ? null : { files: policy.unsupported.files, reason: policy.unsupported.reason },
		status: comparison.status,
		comparedFiles: comparison.comparedFiles,
		evidenceSha256: comparison.evidenceSha256,
		differences: comparison.differences,
		classifications: comparison.classifications,
		totals: comparison.totals,
		changedFiles: evidence,
	};
});

const artifact: ConformanceArtifact = {
	schemaVersion: 1,
	experiment: parsed.experiment,
	generatedAt: new Date().toISOString(),
	corpus: {
		id: manifest.id,
		visibility: manifest.visibility,
		files: selected.length,
		sourceBytes: selected.reduce((total, file) => total + file.bytes, 0),
		selection: parsed.ids === undefined ? manifest.selection : `Manifest subset ids: ${parsed.ids.join(',')}`,
	},
	oracle: {
		fields: CONFORMANCE_FIELDS,
		semanticBoundary: {
			acceptedUnits: 'Top-level script_unit count plus structural parse-tree SHA-256.',
			declarations: 'Not extracted by this laboratory; identical parse trees bound the semantic consumer input.',
			references: 'Not extracted by this laboratory; external qualification remains required.',
			dependencies: 'Not extracted by this laboratory; external qualification remains required.',
			diagnostics: 'Counts plus a SHA-256 over the ordered lexer and final parser diagnostics; message text is never published.',
			recovery: 'Final parse tree, unit count, and diagnostic sequence must match.',
		},
		classification: {
			intended: 'Only the declared field transition, with parse trees, units, tokens, and diagnostics unchanged.',
			unsupported: 'Explicitly allowlisted files that both states reject; requires external classification.',
			defect: 'Any other difference; the gate fails.',
		},
	},
	runtimeBoundary: {
		typescript: 'Semantic-conformance gated for issues #1–#3, #18, #19, #20, and the combined final state.',
		java: 'The official grammar produces 367 parser diagnostics on the frozen production corpus; cross-runtime tree conformance remains required before Java is eligible as a replacement.',
	},
	status: gates.every((gate) => gate.status === 'pass') ? 'pass' : 'fail',
	gates,
};

const resultDirectory = path.join(root, 'results', parsed.experiment);
mkdirSync(resultDirectory, { recursive: true });
writeFileSync(path.join(resultDirectory, 'conformance.json'), `${JSON.stringify(artifact, null, '\t')}\n`);
writeFileSync(path.join(resultDirectory, 'conformance.md'), renderMarkdown(artifact));

if (parsed.publish !== undefined) {
	const publishDirectory = path.resolve(root, parsed.publish);
	mkdirSync(publishDirectory, { recursive: true });
	writeFileSync(path.join(publishDirectory, 'conformance.json'), `${JSON.stringify(artifact, null, '\t')}\n`);
	writeFileSync(path.join(publishDirectory, 'conformance.md'), renderMarkdown(artifact));
	process.stdout.write(`Published conformance artifact in ${path.relative(root, publishDirectory)}.\n`);
}

if (artifact.status !== 'pass') {
	process.exitCode = 1;
}

function parseArguments(args: readonly string[]): ParsedArguments {
	let manifestValue = path.join(root, '.work', 'private-production', 'manifest.json');
	let experiment = 'semantic-conformance';
	let changeSet = 'all';
	let ids: readonly number[] | undefined;
	let publish: string | undefined;
	let stateRootValue: string | undefined;
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
			case '--experiment': {
				experiment = value;
				break;
			}
			case '--change-set': {
				changeSet = value;
				break;
			}
			case '--ids': {
				ids = value.split(',').map(Number);

				if (ids.some((id) => !Number.isInteger(id) || id < 0)) {
					throw new Error('--ids must be a comma-separated list of non-negative integers');
				}

				break;
			}
			case '--publish': {
				publish = value;
				break;
			}
			case '--state-root': {
				stateRootValue = path.resolve(value);
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
		experiment,
		changeSets: selectChangeSets(changeSet),
		ids,
		publish,
		stateRoot: stateRootValue,
		dryRun,
	};
}

function selectChangeSets(value: string): readonly ConformanceChangeSet[] {
	if (value === 'all') {
		return CONFORMANCE_CHANGE_SETS;
	}

	const names = value.split(',').map((name) => name.trim());
	const selectedChanges = CONFORMANCE_CHANGE_SETS.filter((change) => names.includes(change.id));

	if (selectedChanges.length !== names.length) {
		throw new Error(`Unknown change set: ${value}`);
	}

	return selectedChanges;
}

function collectStates(changeSets: readonly ConformanceChangeSet[]): readonly PreparedState[] {
	const collected = new Map<string, PreparedState>();

	for (const change of changeSets) {
		for (const optimizations of [change.control, change.candidate]) {
			const key = stateKey(optimizations);
			collected.set(key, {
				key,
				optimizations,
				generatedDirectory: path.join(stateRoot, key, 'generated'),
			});
		}
	}

	return [...collected.values()];
}

function stateKey(optimizations: readonly GeneratedParserOptimization[]): string {
	return optimizations.length === 0 ? 'none' : optimizations.join('+');
}

function formatOptimizations(optimizations: readonly GeneratedParserOptimization[]): string {
	return optimizations.length === 0 ? 'none' : optimizations.join(',');
}

function generatedStateCommand(optimizations: readonly GeneratedParserOptimization[]): string {
	return `LAB_GENERATED_OPTIMIZATIONS=${formatOptimizations(optimizations)} pnpm grammar:generate (output under .work/conformance/<experiment>/${stateKey(optimizations)})`;
}

function prepareState(state: PreparedState): void {
	const stateDirectory = path.dirname(state.generatedDirectory);
	rmSync(stateDirectory, { recursive: true, force: true });
	mkdirSync(stateDirectory, { recursive: true });
	const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'generate-typescript.ts')], {
		cwd: root,
		env: {
			...process.env,
			LAB_GENERATED_OPTIMIZATIONS: formatOptimizations(state.optimizations),
			LAB_GENERATED_OUTPUT: state.generatedDirectory,
		},
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		throw new Error(`Generated parser state ${state.key} failed:\n${result.stderr}`);
	}

	for (const base of ['plSqlLexerBase.ts', 'plSqlParserBase.ts']) {
		cpSync(path.join(root, 'grammar', 'typescript', base), path.join(stateDirectory, base));
	}
}

function runState(state: PreparedState, onProgress: (completed: number) => void): Promise<readonly ConformanceObservation[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [path.join(root, 'grammar', 'typescript', 'conformanceHarness.ts')], {
			cwd: root,
			env: {
				...process.env,
				LAB_MANIFEST: manifestPath,
				LAB_FILES: filesDir,
				LAB_GENERATED_PARSER_DIR: state.generatedDirectory,
				LAB_STATE: state.key,
				...(parsed.ids === undefined ? {} : { LAB_IDS: parsed.ids.join(',') }),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let pending = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
			pending += chunk;

			for (;;) {
				const newline = pending.indexOf('\n');

				if (newline < 0) {
					break;
				}
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				const match = /\[(?<completed>\d+)\/(?<total>\d+)\] elapsed/u.exec(line);

				if (match?.groups === undefined) {
					process.stderr.write(`${line}\n`);
				} else {
					onProgress(Number(match.groups['completed']));
				}
			}
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Conformance pass ${state.key} failed:\n${stderr}`));
				return;
			}

			const start = stdout.indexOf('{');

			if (start < 0) {
				reject(new Error(`Conformance pass ${state.key} produced no JSON`));
				return;
			}

			const parsedOutput: unknown = JSON.parse(stdout.slice(start));

			if (!isStateOutput(parsedOutput)) {
				reject(new Error(`Conformance pass ${state.key} produced an invalid observation set`));
				return;
			}

			if (parsedOutput.files.length !== selected.length) {
				reject(new Error(`Conformance pass ${state.key} covered ${String(parsedOutput.files.length)} of ${String(selected.length)} files`));
				return;
			}

			const byIdentity = new Map(selected.map((file) => [file.file, file]));

			for (const observation of parsedOutput.files) {
				const file = byIdentity.get(observation.file);

				if (file === undefined || file.sha256 !== observation.sha256 || file.bytes !== observation.bytes) {
					reject(new Error(`Conformance pass ${state.key} does not match manifest identity ${observation.file}`));
					return;
				}
			}

			resolve(parsedOutput.files);
		});
	});
}

function isStateOutput(value: unknown): value is Readonly<{ state: string; files: readonly ConformanceObservation[] }> {
	if (typeof value !== 'object' || value === null || !('state' in value) || !('files' in value)) {
		return false;
	}

	const state = Reflect.get(value, 'state');
	const files = Reflect.get(value, 'files');

	return typeof state === 'string' && Array.isArray(files) && files.every(isObservation);
}

function isObservation(value: unknown): value is ConformanceObservation {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const file = Reflect.get(value, 'file');
	const bytes = Reflect.get(value, 'bytes');
	const sha256 = Reflect.get(value, 'sha256');
	const parseTreeSha256 = Reflect.get(value, 'parseTreeSha256');
	const unitCount = Reflect.get(value, 'unitCount');
	const accepted = Reflect.get(value, 'accepted');
	const lexerDiagnostics = Reflect.get(value, 'lexerDiagnostics');
	const parseDiagnostics = Reflect.get(value, 'parseDiagnostics');
	const diagnosticsSha256 = Reflect.get(value, 'diagnosticsSha256');
	const tokens = Reflect.get(value, 'tokens');
	const hiddenTokens = Reflect.get(value, 'hiddenTokens');
	const prediction = Reflect.get(value, 'prediction');
	const sllAttempts = Reflect.get(value, 'sllAttempts');
	const llAttempts = Reflect.get(value, 'llAttempts');

	return (
		typeof file === 'string' &&
		typeof bytes === 'number' &&
		typeof sha256 === 'string' &&
		typeof parseTreeSha256 === 'string' &&
		typeof unitCount === 'number' &&
		typeof accepted === 'boolean' &&
		typeof lexerDiagnostics === 'number' &&
		typeof parseDiagnostics === 'number' &&
		typeof diagnosticsSha256 === 'string' &&
		typeof tokens === 'number' &&
		typeof hiddenTokens === 'number' &&
		(prediction === 'sll' || prediction === 'sll-fallback-ll' || prediction === 'unknown') &&
		typeof sllAttempts === 'number' &&
		typeof llAttempts === 'number'
	);
}

function renderMarkdown(value: ConformanceArtifact): string {
	const gateRows = value.gates.map((gate) => {
		const controlDiagnostics = gate.totals.controlLexerDiagnostics + gate.totals.controlParseDiagnostics;
		const candidateDiagnostics = gate.totals.candidateLexerDiagnostics + gate.totals.candidateParseDiagnostics;
		return `| ${gate.id} | #${String(gate.issue)} | ${gate.experiment} | ${gate.status} | ${String(gate.comparedFiles)} | ${String(gate.classifications.identical)} | ${String(gate.classifications.intended)} | ${String(gate.classifications.unsupported)} | ${String(gate.classifications.defect)} | ${String(controlDiagnostics)} | ${String(candidateDiagnostics)} | ${String(gate.totals.controlFallbackFiles)} → ${String(gate.totals.candidateFallbackFiles)} |`;
	});

	return [
		`# ${value.experiment}`,
		'',
		`Corpus: ${value.corpus.id} (${value.corpus.visibility}), ${String(value.corpus.files)} files, ${formatBytes(value.corpus.sourceBytes)}.`,
		'',
		`Gate status: **${value.status}**. A gate fails on any unexplained parse-tree, unit, token, or diagnostic difference.`,
		'',
		'| Gate | Issue | Experiment | Status | Compared | Identical | Intended | Unsupported | Defects | Control diagnostics | Candidate diagnostics | Fallback files |',
		'| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...gateRows,
		'',
		'Parse-tree identity is the strongest available semantic boundary in this laboratory. Declarations, references, and dependencies are not extracted here; external qualification remains required.',
		'',
		'Java remains evidence-only: cross-runtime conformance must pass before adoption, regardless of speed.',
		'',
	].join('\n');
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
