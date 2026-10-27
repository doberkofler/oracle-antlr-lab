import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	assertOpaqueIdentities,
	type ConformanceClassification,
	type ConformanceComparison,
	CONFORMANCE_FIELDS,
	type ConformanceField,
	type ConformanceObservation,
	type ConformancePolicy,
	compareConformance,
} from '../src/conformance.ts';
import { buildCorpusPolicy } from '../src/corpusTransitionPolicy.ts';
import { loadManifest } from '../src/corpus.ts';
import { type FixtureExpectation, UPSTREAM_GRAMMAR_FIXTURES, UPSTREAM_GRAMMAR_STABLE_FIXTURES } from '../src/upstreamGrammarFixtures.ts';
import {
	defaultStateRoot,
	type GrammarStateDefinition,
	type GrammarStateDigests,
	type GrammarStatesManifest,
	type MaterializedGrammarState,
	readGrammarStates,
	readGrammarStateLock,
	stateByKey,
} from './grammarStateSource.ts';
import { prepareGrammarStates } from './grammarStatePreparation.ts';

const usage = `Usage: pnpm conformance:grammar [options]

Options:
  --manifest <path>          Corpus manifest (default: .work/private-production/manifest.json)
  --fixtures <path>          Fixture manifest (default: corpora/upstream-prs/manifest.json)
  --corpus-policy <path>     Declared corpus acceptance transitions (optional)
  --experiment <name>        Result directory name (default: upstream-grammar)
  --states <keys>            Candidate states: all, or named comma-separated keys (default: all)
  --ids <n,n>                Optional corpus id subset for a smoke run
  --state-root <path>        Grammar-state directory (default: .work/grammar-states)
  --regenerate               Regenerate every parser even when its marker matches
  --report-only              Write the report without failing on an unsuccessful gate
  --render <json>            Regenerate conformance.md from an existing artifact and exit
  --publish <path>           Copy conformance.json and conformance.md to this directory
  --dry-run                  Print the gates and state identities without running
  --help                     Show this message
`;

/** Rules introduced only to restructure a statement and carrying no semantics. */
const STRUCTURAL_WRAPPER_RULES = ['alter_table_body', 'alter_table_action', 'enable_disable_clauses'] as const;

/** Generated DFA caches accumulate across files; a chunk stays below the Node heap ceiling. */
const HARNESS_CHUNK_SIZE = 150;

type HarnessObservation = ConformanceObservation &
	Readonly<{
		symbolicTreeSha256: string;
		normalizedTreeSha256: string;
	}>;

type ParsedArguments = Readonly<{
	manifest: string;
	fixtures: string;
	corpusPolicy: string | undefined;
	experiment: string;
	states: readonly string[];
	ids: readonly number[] | undefined;
	stateRoot: string;
	regenerate: boolean;
	reportOnly: boolean;
	render: string | undefined;
	publish: string | undefined;
	dryRun: boolean;
}>;

type WorkspaceFile = Readonly<{ id: number; path: string; sha256: string; bytes: number }>;

type Workspace = Readonly<{
	manifestPath: string;
	filesDirectory: string;
	files: readonly WorkspaceFile[];
}>;

type ComparisonSummary = Readonly<{
	status: 'pass' | 'fail';
	comparedFiles: number;
	classifications: Readonly<Record<ConformanceClassification, number>>;
	differences: Readonly<Record<ConformanceField, number>>;
	totals: ConformanceComparison['totals'];
	changedFiles: readonly Readonly<{
		file: string;
		bytes: number;
		sha256: string;
		classification: ConformanceClassification;
		changedFields: readonly string[];
		reason?: string;
	}>[];
}>;

type FixtureCheck = Readonly<{
	state: string;
	file: string;
	control: string;
	candidate: string;
	expected: string;
	pass: boolean;
}>;

type GateRecord = Readonly<{
	id: string;
	title: string;
	candidate: string;
	pullRequest: number | null;
	status: 'pass' | 'fail';
	corpus: ComparisonSummary;
	fixtures: ComparisonSummary;
	fixtureChecks: readonly FixtureCheck[];
}>;

type StateRecord = Readonly<{
	key: string;
	title: string;
	ref: string | null;
	pullRequest: number | null;
	merge: readonly string[];
	digests: GrammarStateDigests;
}>;

type Artifact = Readonly<{
	schemaVersion: 1;
	experiment: string;
	generatedAt: string;
	upstream: Readonly<{ repository: string; control: string; base: string }>;
	corpus: Readonly<{ id: string; visibility: string; files: number; sourceBytes: number }>;
	fixtures: Readonly<{ id: string; visibility: string; files: number; sourceBytes: number }>;
	corpusPolicy: Readonly<{ path: string | null; sha256: string | null }>;
	optimizations: 'default';
	treeDigest: Readonly<{ kind: 'symbolic'; ignoredRules: readonly string[] }>;
	states: readonly StateRecord[];
	status: 'pass' | 'fail';
	gates: readonly GateRecord[];
}>;

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));

if (parsed.render !== undefined) {
	renderExisting(parsed.render);
	process.exit(0);
}

const manifest = readGrammarStates(root);
const lock = readGrammarStateLock(root);

if (lock === undefined) {
	throw new Error('grammar/states.lock.json is required; run pnpm grammar:states');
}

const corpus = loadWorkspace(parsed.manifest);
const fixtures = loadWorkspace(parsed.fixtures);
const control = stateByKey(manifest, 'control');
const candidates = parsed.dryRun ? [] : selectCandidates(manifest, parsed.states);

if (parsed.dryRun) {
	process.stdout.write(`Control: ${control.key} (${control.ref ?? 'no ref'})\n`);
	process.stdout.write(`Candidates: ${parsed.states.join(', ')}\n`);
	process.stdout.write(`Corpus: ${corpus.manifestPath} (${String(corpus.files.length)} files)\n`);
	process.stdout.write(`Fixtures: ${fixtures.manifestPath} (${String(fixtures.files.length)} files)\n`);
	process.stdout.write(`Ignored structural rules: ${STRUCTURAL_WRAPPER_RULES.join(', ')}\n`);
	process.exit(0);
}

const stateRoot = path.resolve(parsed.stateRoot);
const prepared = await prepareGrammarStates({
	root,
	manifest,
	lock,
	states: [control, ...candidates],
	stateRoot,
	regenerate: parsed.regenerate,
});
const stateRecords = prepared.map((state) => recordState(state.materialized));

const controlObservations = runState(control.key, corpus, fixtures, stateRoot);
const gates: GateRecord[] = [];

for (const candidate of candidates) {
	process.stdout.write(`Running ${candidate.key} conformance passes.\n`);
	const candidateObservations = runState(candidate.key, corpus, fixtures, stateRoot);
	const corpusComparison = compareObservations(
		controlObservations.corpus,
		candidateObservations.corpus,
		buildCorpusPolicy(candidate.key, parsed.corpusPolicy),
	);
	const fixtureScope = fixtureScopeFor(candidate.key);
	const controlFixtures = controlObservations.fixtures.filter((observation) => fixtureScope.has(observation.file));
	const candidateFixtures = candidateObservations.fixtures.filter((observation) => fixtureScope.has(observation.file));
	const fixturePolicy = buildFixturePolicy(candidate.key, fixtures);
	const fixtureComparison = compareObservations(controlFixtures, candidateFixtures, fixturePolicy);
	const fixtureChecks = checkFixtures(candidate.key, controlObservations.fixtures, candidateObservations.fixtures);
	const status = corpusComparison.status === 'pass' && fixtureComparison.status === 'pass' && fixtureChecks.every((check) => check.pass) ? 'pass' : 'fail';

	gates.push({
		id: `${control.key}-vs-${candidate.key}`,
		title: candidate.title,
		candidate: candidate.key,
		pullRequest: candidate.pullRequest ?? null,
		status,
		corpus: summarize(corpusComparison),
		fixtures: summarize(fixtureComparison),
		fixtureChecks,
	});
	process.stdout.write(
		`${candidate.key}: ${status}; corpus ${String(corpusComparison.classifications.identical)} identical, ${String(corpusComparison.classifications.intended)} intended, ${String(corpusComparison.classifications.defect)} defect; fixtures ${String(fixtureComparison.classifications.defect)} defect.\n`,
	);
}

const artifact: Artifact = {
	schemaVersion: 1,
	experiment: parsed.experiment,
	generatedAt: new Date().toISOString(),
	upstream: {
		repository: manifest.upstream,
		control: control.key,
		base: control.ref ?? '',
	},
	corpus: {
		id: corpus.manifest.id,
		visibility: corpus.manifest.visibility,
		files: corpus.files.length,
		sourceBytes: corpus.files.reduce((total, file) => total + file.bytes, 0),
	},
	fixtures: {
		id: fixtures.manifest.id,
		visibility: fixtures.manifest.visibility,
		files: fixtures.files.length,
		sourceBytes: fixtures.files.reduce((total, file) => total + file.bytes, 0),
	},
	corpusPolicy: {
		path: parsed.corpusPolicy === undefined ? null : path.relative(root, parsed.corpusPolicy),
		sha256: parsed.corpusPolicy === undefined ? null : createHash('sha256').update(readFileSync(parsed.corpusPolicy)).digest('hex'),
	},
	optimizations: 'default',
	treeDigest: { kind: 'symbolic', ignoredRules: STRUCTURAL_WRAPPER_RULES },
	states: stateRecords,
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

process.stdout.write(`Overall status: ${artifact.status}.\n`);

if (artifact.status !== 'pass' && !parsed.reportOnly) {
	process.exitCode = 1;
}

function parseArguments(args: readonly string[]): ParsedArguments {
	let manifestPath = path.join(root, '.work', 'private-production', 'manifest.json');
	let fixturePath = path.join(root, 'corpora', 'upstream-prs', 'manifest.json');
	let corpusPolicy: string | undefined;
	let experiment = 'upstream-grammar';
	let stateValue = 'all';
	let ids: readonly number[] | undefined;
	let stateRootValue = defaultStateRoot(root);
	let regenerate = false;
	let reportOnly = false;
	let render: string | undefined;
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

		if (argument === '--regenerate') {
			regenerate = true;
			continue;
		}

		if (argument === '--report-only') {
			reportOnly = true;
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
				manifestPath = path.resolve(value);
				break;
			}
			case '--fixtures': {
				fixturePath = path.resolve(value);
				break;
			}
			case '--corpus-policy': {
				corpusPolicy = path.resolve(value);
				break;
			}
			case '--experiment': {
				experiment = value;
				break;
			}
			case '--states': {
				stateValue = value;
				break;
			}
			case '--ids': {
				ids = value.split(',').map(Number);

				if (ids.some((id) => !Number.isInteger(id) || id < 0)) {
					throw new Error('--ids must be a comma-separated list of non-negative integers');
				}

				break;
			}
			case '--state-root': {
				stateRootValue = path.resolve(value);
				break;
			}
			case '--publish': {
				publish = value;
				break;
			}
			case '--render': {
				render = path.resolve(value);
				break;
			}
			default: {
				throw new Error(`Unknown argument: ${argument}`);
			}
		}

		index += 1;
	}

	return {
		manifest: manifestPath,
		fixtures: fixturePath,
		corpusPolicy,
		experiment,
		states: stateValue.split(',').map((key) => key.trim()),
		ids,
		stateRoot: stateRootValue,
		regenerate,
		reportOnly,
		render,
		publish,
		dryRun,
	};
}

function loadWorkspace(manifestPath: string): Workspace & Readonly<{ manifest: ReturnType<typeof loadManifest>['manifest'] }> {
	const { manifest: corpusManifest, files } = loadManifest(manifestPath, path.join(path.dirname(manifestPath), 'files'));
	assertOpaqueIdentities(corpusManifest.visibility, files);

	return {
		manifestPath,
		filesDirectory: path.join(path.dirname(manifestPath), 'files'),
		files: files.map((file) => ({ id: file.id, path: file.path, sha256: file.sha256, bytes: file.bytes })),
		manifest: corpusManifest,
	};
}

function selectCandidates(states: GrammarStatesManifest, keys: readonly string[]): readonly GrammarStateDefinition[] {
	if (keys.length === 1 && keys[0] === 'all') {
		return states.states.filter((state) => state.pullRequest !== undefined || state.merge !== undefined);
	}

	return keys.map((key) => stateByKey(states, key));
}

function recordState(state: MaterializedGrammarState): StateRecord {
	return {
		key: state.definition.key,
		title: state.definition.title,
		ref: state.definition.ref ?? null,
		pullRequest: state.definition.pullRequest ?? null,
		merge: state.definition.merge ?? [],
		digests: state.digests,
	};
}

function runState(
	key: string,
	corpusWorkspace: Workspace,
	fixtureWorkspace: Workspace,
	stateRootDirectory: string,
): Readonly<{ corpus: readonly HarnessObservation[]; fixtures: readonly HarnessObservation[] }> {
	const stateDirectory = path.join(stateRootDirectory, key);

	return {
		corpus: invokeHarness(key, stateDirectory, corpusWorkspace),
		fixtures: invokeHarness(`${key}-fixtures`, stateDirectory, fixtureWorkspace),
	};
}

function invokeHarness(key: string, stateDirectory: string, workspace: Workspace): readonly HarnessObservation[] {
	const selectedFiles = parsed.ids === undefined ? workspace.files : workspace.files.filter((file) => parsed.ids?.includes(file.id) ?? false);
	const ids = selectedFiles.map((file) => file.id);
	const chunks: number[][] = [];

	for (let index = 0; index < ids.length; index += HARNESS_CHUNK_SIZE) {
		chunks.push(ids.slice(index, index + HARNESS_CHUNK_SIZE));
	}

	const observations: HarnessObservation[] = [];

	for (const [index, chunk] of chunks.entries()) {
		const chunkKey = chunks.length === 1 ? key : `${key}#${String(index + 1)}`;
		observations.push(...runHarnessChunk(chunkKey, stateDirectory, workspace, chunk));
	}

	return observations;
}

function runHarnessChunk(key: string, stateDirectory: string, workspace: Workspace, ids: readonly number[]): readonly HarnessObservation[] {
	const result = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(root, 'grammar', 'typescript', 'conformanceHarness.ts')], {
		cwd: root,
		env: {
			...process.env,
			LAB_MANIFEST: workspace.manifestPath,
			LAB_FILES: workspace.filesDirectory,
			LAB_GENERATED_PARSER_DIR: path.join(stateDirectory, 'generated'),
			LAB_STATE: key,
			LAB_IGNORE_RULES: STRUCTURAL_WRAPPER_RULES.join(','),
			LAB_IDS: ids.join(','),
		},
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});

	if (result.status !== 0) {
		throw new Error(`Conformance pass ${key} failed:\n${result.stderr}`);
	}

	const start = result.stdout.indexOf('{');

	if (start < 0) {
		throw new Error(`Conformance pass ${key} produced no JSON`);
	}

	const output: unknown = JSON.parse(result.stdout.slice(start));

	if (typeof output !== 'object' || output === null || !('files' in output) || !Array.isArray(output.files)) {
		throw new Error(`Conformance pass ${key} produced an invalid observation set`);
	}

	if (output.files.length !== ids.length) {
		throw new Error(`Conformance pass ${key} covered ${String(output.files.length)} of ${String(ids.length)} files`);
	}

	const observations = output.files.map((file: unknown) => parseObservation(file, key));

	for (const [index, observation] of observations.entries()) {
		const expected = workspace.files.find((file) => file.id === ids[index]);

		if (expected === undefined || expected.path !== observation.file || expected.sha256 !== observation.sha256 || expected.bytes !== observation.bytes) {
			throw new Error(`Conformance pass ${key} does not match manifest identity ${observation.file}`);
		}
	}

	return observations;
}

function parseObservation(value: unknown, key: string): HarnessObservation {
	if (typeof value !== 'object' || value === null) {
		throw new Error(`Conformance pass ${key} contains a non-object observation`);
	}

	const fields = CONFORMANCE_FIELDS.map((field) => Reflect.get(value, field));
	const symbolic = Reflect.get(value, 'symbolicTreeSha256');
	const normalized = Reflect.get(value, 'normalizedTreeSha256');

	if (fields.some((field) => field === undefined) || typeof symbolic !== 'string' || typeof normalized !== 'string') {
		throw new Error(`Conformance pass ${key} contains an incomplete observation`);
	}

	return {
		file: String(Reflect.get(value, 'file')),
		bytes: Number(Reflect.get(value, 'bytes')),
		sha256: String(Reflect.get(value, 'sha256')),
		parseTreeSha256: normalized,
		unitCount: Number(Reflect.get(value, 'unitCount')),
		accepted: Boolean(Reflect.get(value, 'accepted')),
		lexerDiagnostics: Number(Reflect.get(value, 'lexerDiagnostics')),
		parseDiagnostics: Number(Reflect.get(value, 'parseDiagnostics')),
		diagnosticsSha256: String(Reflect.get(value, 'diagnosticsSha256')),
		tokens: Number(Reflect.get(value, 'tokens')),
		hiddenTokens: Number(Reflect.get(value, 'hiddenTokens')),
		prediction: predictionOf(Reflect.get(value, 'prediction')),
		sllAttempts: Number(Reflect.get(value, 'sllAttempts')),
		llAttempts: Number(Reflect.get(value, 'llAttempts')),
		symbolicTreeSha256: symbolic,
		normalizedTreeSha256: normalized,
	};
}

function predictionOf(value: unknown): ConformanceObservation['prediction'] {
	if (value === 'sll' || value === 'sll-fallback-ll' || value === 'unknown') {
		return value;
	}

	throw new Error(`Invalid prediction value: ${String(value)}`);
}

function compareObservations(
	baseline: readonly HarnessObservation[],
	treated: readonly HarnessObservation[],
	policy: ConformancePolicy,
): ConformanceComparison {
	return compareConformance(baseline, treated, policy);
}

function outcomesByName(observations: readonly HarnessObservation[]): ReadonlyMap<string, HarnessObservation> {
	return new Map(observations.map((observation) => [observation.file, observation]));
}

function expectedFor(candidateKey: string): readonly FixtureExpectation[] {
	if (candidateKey === 'cumulative') {
		return UPSTREAM_GRAMMAR_FIXTURES;
	}

	return UPSTREAM_GRAMMAR_FIXTURES.filter((expectation) => expectation.state === candidateKey);
}

function stableFor(candidateKey: string): readonly Readonly<{ state: string; file: string; reason: string }>[] {
	return candidateKey === 'cumulative' ? UPSTREAM_GRAMMAR_STABLE_FIXTURES : UPSTREAM_GRAMMAR_STABLE_FIXTURES.filter((entry) => entry.state === candidateKey);
}

function fixtureScopeFor(candidateKey: string): ReadonlySet<string> {
	return new Set([...expectedFor(candidateKey).map((expectation) => expectation.file), ...stableFor(candidateKey).map((entry) => entry.file)]);
}

function buildFixturePolicy(candidateKey: string, workspace: Workspace): ConformancePolicy {
	const expected = expectedFor(candidateKey);
	const byName = new Map(workspace.files.map((file) => [file.path, file]));
	const files = expected
		.map((expectation) => byName.get(expectation.file))
		.filter((file): file is WorkspaceFile => file !== undefined)
		.map((file) => file.sha256);
	const expectations = expected
		.map((expectation) => ({ expectation, file: byName.get(expectation.file) }))
		.filter((entry): entry is Readonly<{ expectation: FixtureExpectation; file: WorkspaceFile }> => entry.file !== undefined);

	return {
		intendedFiles: {
			files,
			fields: CONFORMANCE_FIELDS,
			reason: 'A reduced upstream fixture moves from the declared control outcome to the declared candidate outcome.',
			allows: (controlObservation, candidateObservation) =>
				expectations.some(
					(entry) =>
						entry.file.sha256 === controlObservation.sha256 &&
						outcome(controlObservation) === entry.expectation.control &&
						outcome(candidateObservation) === entry.expectation.candidate,
				),
		},
	};
}

function outcome(observation: ConformanceObservation): FixtureExpectation['control'] {
	return observation.accepted ? 'accepted' : 'rejected';
}

function checkFixtures(candidateKey: string, baseline: readonly HarnessObservation[], treated: readonly HarnessObservation[]): readonly FixtureCheck[] {
	const controlByName = outcomesByName(baseline);
	const candidateByName = outcomesByName(treated);
	const expected = expectedFor(candidateKey);

	return [
		...expected.map((expectation) => {
			const controlObservation = controlByName.get(expectation.file);
			const candidateObservation = candidateByName.get(expectation.file);
			const actualControl = controlObservation === undefined ? 'missing' : outcome(controlObservation);
			const actualCandidate = candidateObservation === undefined ? 'missing' : outcome(candidateObservation);

			return {
				state: candidateKey,
				file: expectation.file,
				control: actualControl,
				candidate: actualCandidate,
				expected: `${expectation.control} -> ${expectation.candidate}`,
				pass: actualControl === expectation.control && actualCandidate === expectation.candidate,
			};
		}),
		...stableFor(candidateKey).map((entry) => {
			const controlObservation = controlByName.get(entry.file);
			const candidateObservation = candidateByName.get(entry.file);
			const actualControl = controlObservation === undefined ? 'missing' : outcome(controlObservation);
			const actualCandidate = candidateObservation === undefined ? 'missing' : outcome(candidateObservation);

			return {
				state: candidateKey,
				file: entry.file,
				control: actualControl,
				candidate: actualCandidate,
				expected: 'accepted -> accepted',
				pass: actualControl === 'accepted' && actualCandidate === 'accepted',
			};
		}),
	];
}

function summarize(comparison: ConformanceComparison): ComparisonSummary {
	return {
		status: comparison.status,
		comparedFiles: comparison.comparedFiles,
		classifications: comparison.classifications,
		differences: comparison.differences,
		totals: comparison.totals,
		changedFiles: comparison.files
			.filter((file) => file.classification !== 'identical')
			.map((file) => ({
				file: file.file,
				bytes: file.bytes,
				sha256: file.sha256,
				classification: file.classification,
				changedFields: file.changedFields,
				...(file.reason === undefined ? {} : { reason: file.reason }),
			})),
	};
}

function renderExisting(file: string): void {
	const parsedArtifact: unknown = JSON.parse(readFileSync(file, 'utf8'));

	if (typeof parsedArtifact !== 'object' || parsedArtifact === null || !('gates' in parsedArtifact) || !Array.isArray(parsedArtifact.gates)) {
		throw new Error(`${file} is not a conformance artifact`);
	}

	// The artifact is produced by this script and only its own fields are read.
	const existing = parsedArtifact as unknown as Artifact;
	const destination = path.join(path.dirname(file), 'conformance.md');
	writeFileSync(destination, renderMarkdown(existing));
	process.stdout.write(`Wrote ${path.relative(root, destination)}.\n`);
}

function renderMarkdown(value: Artifact): string {
	const gateRows = value.gates.map((gate) => {
		const corpusDefects = gate.corpus.classifications.defect;
		const fixtureDefects = gate.fixtures.classifications.defect;
		return `| ${gate.candidate} | ${gate.pullRequest === null ? 'cumulative' : `#${String(gate.pullRequest)}`} | ${gate.status} | ${String(gate.corpus.comparedFiles)} | ${String(gate.corpus.classifications.identical)} | ${String(gate.corpus.classifications.intended)} | ${String(gate.corpus.classifications.unsupported)} | ${String(corpusDefects)} | ${String(gate.fixtures.classifications.identical)} | ${String(gate.fixtures.classifications.intended)} | ${String(gate.fixtures.classifications.unsupported)} | ${String(fixtureDefects)} |`;
	});
	const fixtureRows = value.gates.flatMap((gate) =>
		gate.fixtureChecks.map(
			(check) => `| ${check.state} | ${check.file} | ${check.control} | ${check.candidate} | ${check.expected} | ${check.pass ? 'pass' : 'fail'} |`,
		),
	);
	const stateRows = value.states.map(
		(state) =>
			`| ${state.key} | ${state.pullRequest === null ? '—' : `#${String(state.pullRequest)}`} | ${state.ref ?? state.merge.join(' + ')} | ${state.digests.adapted.lexerSha256.slice(0, 12)} | ${state.digests.adapted.parserSha256.slice(0, 12)} |`,
	);

	return [
		`# ${value.experiment}`,
		'',
		`Upstream: \`${value.upstream.repository}\`; control \`${value.upstream.base}\`.`,
		'',
		`Corpus: ${value.corpus.id} (${value.corpus.visibility}), ${String(value.corpus.files)} files, ${formatBytes(value.corpus.sourceBytes)}. Fixtures: ${value.fixtures.id} (${value.fixtures.visibility}), ${String(value.fixtures.files)} files.`,
		'',
		value.corpusPolicy.path === null
			? 'Corpus differences: none declared; every changed corpus file is a defect.'
			: `Corpus differences: declared in \`${value.corpusPolicy.path}\` (SHA-256 ${value.corpusPolicy.sha256 ?? 'unknown'}).`,
		'',
		`Gate status: **${value.status}**. Parse structure is compared with a symbolic digest over rule and token names. Wrapper rules are flattened: ${value.treeDigest.ignoredRules.join(', ')}.`,
		'',
		'| Candidate | Pull request | Status | Corpus files | Identical | Intended | Unsupported | Defects | Fixtures identical | Fixtures intended | Fixtures unsupported | Fixture defects |',
		'| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...gateRows,
		'',
		'## Fixture transitions',
		'',
		'| State | Fixture | Control | Candidate | Expected | Result |',
		'| --- | --- | --- | --- | --- | --- |',
		...fixtureRows,
		'',
		'## Grammar states',
		'',
		'| State | Pull request | Ref or merge | Adapted lexer | Adapted parser |',
		'| --- | ---: | --- | --- | --- |',
		...stateRows,
		'',
		'Generated parsers are not committed. Every state is materialized from the pinned upstream ref, adapted by the same reviewed patch set, and generated with the default optimization state. A gate fails on any unexplained parse structure, unit, token, acceptance, or diagnostic difference.',
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
