import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { decisionStateCounts, evictDfaAtBoundary, parseSelectiveDfaSchedule, totalDfaStates } from '../grammar/typescript/dfaEviction.ts';
import { parseSource } from '../grammar/typescript/parse.ts';
import { loadManifest } from '../src/corpus.ts';

const usage = `Usage: pnpm dfa:eviction [options]

Runs one cache-reuse pass with the selective DFA bounds from the environment.

Options:
  --manifest <path>       Corpus manifest (default: .work/private-production/manifest.json)
  --experiment <name>     Result directory under results/ (default: selective-dfa-eviction)
  --tree-hash             Include structural parse-tree digests in observations
  --observations <path>   Write per-file comparison observations to this path
  --compare <path>        Compare against a previously written observations file
  --help                  Show this message

Environment:
  LAB_DFA_SELECTIVE_EVERY       Files between enforcement passes
  LAB_DFA_SELECTIVE_HEAP_MIB    Heap-pressure trigger in MiB
  LAB_DFA_HOT_DECISIONS         Comma-separated hot decision numbers
  LAB_DFA_HOT_MAX_STATES        Retained-state limit for hot decisions
  LAB_DFA_COLD_MAX_STATES       Retained-state limit for other decisions
  LAB_DFA_TOTAL_MAX_STATES      Aggregate retained-state limit

Run the control without selective variables and with an 8 GB old-space limit:
  NODE_OPTIONS=--max-old-space-size=8192 pnpm dfa:eviction -- --tree-hash --observations .work/control.json

Run the candidate under Node's default heap:
  LAB_DFA_SELECTIVE_EVERY=10 LAB_DFA_HOT_DECISIONS=2993,2251,2990,2595 \\
  LAB_DFA_HOT_MAX_STATES=90000 LAB_DFA_COLD_MAX_STATES=2000 \\
  pnpm dfa:eviction -- --tree-hash --observations .work/candidate.json --compare .work/control.json
`;

type Observation = Readonly<{
	file: string;
	parseTreeSha256?: string;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	tokens: number;
	hiddenTokens: number;
	prediction: string;
	sllAttempts: number;
	llAttempts: number;
}>;

type Arguments = Readonly<{
	manifest: string;
	experiment: string;
	treeHash: boolean;
	observations: string | undefined;
	compare: string | undefined;
}>;

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));

if (parsed === null) {
	process.stdout.write(usage);
	process.exit(0);
}

const manifestPath = path.resolve(parsed.manifest);
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files } = loadManifest(manifestPath, filesDir);
const schedule = parseSelectiveDfaSchedule(
	process.env['LAB_DFA_SELECTIVE_EVERY'],
	process.env['LAB_DFA_SELECTIVE_HEAP_MIB'],
	process.env['LAB_DFA_HOT_MAX_STATES'],
	process.env['LAB_DFA_COLD_MAX_STATES'],
	process.env['LAB_DFA_TOTAL_MAX_STATES'],
	process.env['LAB_DFA_HOT_DECISIONS'],
);
const startedAt = performance.now();
const observations: Observation[] = [];
const resets = new Map<number, number>();
const enforcements = { count: 0, states: 0 };
let coreMs = 0;
let accepted = 0;
let lexerDiagnostics = 0;
let parseDiagnostics = 0;
let fallbackFiles = 0;
let parser: ReturnType<typeof parseSource>['parser'] | null = null;

for (const [position, entry] of files.entries()) {
	const source = readFileSync(path.join(filesDir, entry.file), 'utf8');
	const result = parseSource(source, entry, { treeHash: parsed.treeHash });
	parser = result.parser;
	coreMs += result.observation.coreMs;
	lexerDiagnostics += result.observation.lexerDiagnostics;
	parseDiagnostics += result.observation.parseDiagnostics;
	accepted += result.observation.lexerDiagnostics === 0 && result.observation.parseDiagnostics === 0 ? 1 : 0;
	fallbackFiles += result.observation.prediction === 'sll-fallback-ll' ? 1 : 0;

	if (parsed.observations !== undefined) {
		observations.push({
			file: result.observation.file,
			lexerDiagnostics: result.observation.lexerDiagnostics,
			parseDiagnostics: result.observation.parseDiagnostics,
			tokens: result.observation.tokens,
			hiddenTokens: result.observation.hiddenTokens,
			prediction: result.observation.prediction,
			sllAttempts: result.observation.sllAttempts,
			llAttempts: result.observation.llAttempts,
			...(result.observation.parseTreeSha256 === undefined ? {} : { parseTreeSha256: result.observation.parseTreeSha256 }),
		});
	}

	const enforcement = evictDfaAtBoundary(parser, position + 1, schedule);

	if (enforcement !== null) {
		enforcements.count += 1;
		enforcements.states += enforcement.statesBefore - enforcement.statesAfter;

		for (const decision of enforcement.decisions) {
			resets.set(decision, (resets.get(decision) ?? 0) + 1);
		}
	}

	if ((position + 1) % 100 === 0 || position + 1 === files.length) {
		process.stderr.write(
			`[${String(position + 1)}/${String(files.length)}] ${formatDuration(performance.now() - startedAt)} heap=${String(Math.round(process.memoryUsage().heapUsed / 1_048_576))} MiB states=${String(totalDfaStates(parser))}\n`,
		);
	}
}

const summary = {
	schemaVersion: 1,
	experiment: parsed.experiment,
	generatedAt: new Date().toISOString(),
	corpus: { id: manifest.id, files: manifest.sourceFiles, sourceBytes: manifest.sourceBytes, visibility: manifest.visibility },
	policy: {
		...schedule,
		policy: { ...schedule.policy, hotDecisions: [...schedule.policy.hotDecisions] },
	},
	files: files.length,
	coreMs,
	wallMs: performance.now() - startedAt,
	peakRssBytes: process.resourceUsage().maxRSS * 1024,
	accepted,
	lexerDiagnostics,
	parseDiagnostics,
	fallbackFiles,
	enforcements,
	decisionResets: [...resets.entries()].sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0)),
	finalStates: totalDfaStates(parser ?? missingParser()),
	topFinal: decisionStateCounts(parser ?? missingParser())
		.map((states, decision) => ({ decision, states }))
		.filter((item) => item.states > 0)
		.sort((left, right) => right.states - left.states)
		.slice(0, 20),
};
const resultDir = path.join(root, 'results', parsed.experiment);
mkdirSync(resultDir, { recursive: true });
writeFileSync(path.join(resultDir, 'selective-dfa.json'), `${JSON.stringify(summary, null, '\t')}\n`);

if (parsed.observations !== undefined) {
	writeFileSync(parsed.observations, `${JSON.stringify(observations)}\n`);
}

if (parsed.compare !== undefined) {
	const differences = compareObservations(readFileSync(parsed.compare, 'utf8'), observations);

	if (differences > 0) {
		throw new Error(`${String(differences)} files differ from ${parsed.compare}`);
	}
}

process.stdout.write(
	`${parsed.experiment}: ${String(files.length)} files, core ${(coreMs / 1_000).toFixed(3)} s, peak RSS ${(summary.peakRssBytes / 1e9).toFixed(3)} GB, accepted ${String(accepted)}, diagnostics ${String(lexerDiagnostics + parseDiagnostics)}, fallbacks ${String(fallbackFiles)}, final states ${String(summary.finalStates)}\n`,
);

function parseArguments(argv: readonly string[]): Arguments | null {
	const values = [...argv];
	let manifestArg = '.work/private-production/manifest.json';
	let experimentArg = 'selective-dfa-eviction';
	let treeHashArg = false;
	let observationsArg: string | undefined;
	let compareArg: string | undefined;

	for (let index = 0; index < values.length; index += 1) {
		const argument = values[index];

		switch (argument) {
			case '--manifest':
				index += 1;
				manifestArg = requiredValue(values[index], '--manifest');
				break;
			case '--experiment':
				index += 1;
				experimentArg = requiredValue(values[index], '--experiment');
				break;
			case '--observations':
				index += 1;
				observationsArg = requiredValue(values[index], '--observations');
				break;
			case '--compare':
				index += 1;
				compareArg = requiredValue(values[index], '--compare');
				break;
			case '--tree-hash':
				treeHashArg = true;
				break;
			case '--':
				break;
			case '--help':
				return null;
			default:
				throw new Error(`Unknown option: ${String(argument)}`);
		}
	}

	return { manifest: manifestArg, experiment: experimentArg, treeHash: treeHashArg, observations: observationsArg, compare: compareArg };
}

function requiredValue(value: string | undefined, name: string): string {
	if (value === undefined) {
		throw new Error(`${name} requires a value`);
	}

	return value;
}

function compareObservations(controlText: string, candidate: readonly Observation[]): number {
	const control = JSON.parse(controlText) as readonly Observation[];

	if (control.length !== candidate.length) {
		throw new Error(`Observation count differs: control ${String(control.length)}, candidate ${String(candidate.length)}`);
	}

	const fields = ['parseTreeSha256', 'lexerDiagnostics', 'parseDiagnostics', 'tokens', 'hiddenTokens', 'prediction', 'sllAttempts', 'llAttempts'] as const;
	let differences = 0;

	for (const [index, candidateObservation] of candidate.entries()) {
		const controlObservation = control[index];

		if (controlObservation === undefined || controlObservation.file !== candidateObservation.file) {
			throw new Error(`Observation order differs at position ${String(index + 1)}`);
		}

		if (fields.some((field) => controlObservation[field] !== candidateObservation[field])) {
			differences += 1;
		}
	}

	return differences;
}

function missingParser(): never {
	throw new Error('The corpus selection was empty');
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
}
