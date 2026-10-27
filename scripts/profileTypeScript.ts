import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CharStream, CommonTokenStream } from 'antlr4ng';

import { PlSqlLexer } from '../grammar/typescript/generated/PlSqlLexer.ts';
import { PlSqlParser } from '../grammar/typescript/generated/PlSqlParser.ts';
import { prepareConditional } from '../src/conditional.ts';
import { median } from '../src/stats.ts';
import { type ParseObservation } from '../src/types.ts';

type ProductionReport = Readonly<{
	corpus: Readonly<{ files: readonly Readonly<{ id: number; path: string; file: string; bytes: number; sha256: string }>[] }>;
	runs: Readonly<Record<string, readonly Readonly<{ files: readonly ParseObservation[] }>[]>>;
}>;

type DecisionTotal = {
	timeInPredictionMs: number;
	invocations: number;
	sllAtnTransitions: number;
	sllDfaTransitions: number;
	llAtnTransitions: number;
	llDfaTransitions: number;
	llFallbacks: number;
	ambiguities: number;
};

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, '.work', 'private-production', 'manifest.json'));
const productionReportPath = path.resolve(process.argv[3] ?? path.join(root, 'results', 'official-grammar-production', 'raw-report.json'));
const outputPath = path.resolve(process.argv[4] ?? path.join(root, 'results', 'typescript-official-grammar-profile.json'));
const report = JSON.parse(readFileSync(productionReportPath, 'utf8')) as ProductionReport;
const runs = report.runs['typescript'];

if (runs === undefined || runs.length === 0) {
	throw new Error('Production report has no TypeScript runs');
}

const selected = report.corpus.files
	.map((file) => ({ ...file, medianCoreMs: median(runs.map((run) => run.files[file.id]?.coreMs ?? 0)) }))
	.sort((left, right) => right.medianCoreMs - left.medianCoreMs)
	.slice(0, 12);
const filesDir = path.join(path.dirname(manifestPath), 'files');
const decisions = new Map<number, DecisionTotal>();
const startedAt = performance.now();

for (const [index, file] of selected.entries()) {
	profileSource(prepareConditional(readFileSync(path.join(filesDir, file.file), 'utf8')));
	process.stderr.write(`[${String(index + 1)}/${String(selected.length)}] elapsed ${formatDuration(performance.now() - startedAt)}\n`);
}

const decisionRows = [...decisions.entries()]
	.map(([decision, total]) => {
		const ruleIndex = PlSqlParser._ATN.decisionToState[decision]?.ruleIndex;
		return { decision, rule: ruleIndex === undefined ? 'unknown' : (PlSqlParser.ruleNames[ruleIndex] ?? 'unknown'), ...total };
	})
	.sort((left, right) => right.timeInPredictionMs - left.timeInPredictionMs);
const rules = new Map<string, DecisionTotal>();

for (const decision of decisionRows) {
	add(rules, decision.rule, decision);
}

const result = {
	schemaVersion: 1,
	experiment: 'typescript-official-grammar-profile',
	generatedAt: new Date().toISOString(),
	selection: '12 files with highest median optimized TypeScript parser-core time in the official-grammar production baseline',
	files: selected,
	elapsedMs: performance.now() - startedAt,
	rules: [...rules.entries()].map(([rule, total]) => ({ rule, ...total })).sort((left, right) => right.timeInPredictionMs - left.timeInPredictionMs),
	decisions: decisionRows,
};

writeFileSync(outputPath, `${JSON.stringify(result, null, '\t')}\n`);
process.stdout.write(`Profile complete: ${path.relative(root, outputPath)}\n`);

function profileSource(source: string): void {
	const stream = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
	stream.fill();
	const parse = (mode: 0 | 1): PlSqlParser => {
		const parser = new PlSqlParser(stream);
		parser.removeErrorListeners();
		parser.setProfile(true);
		const interpreter = parser.interpreter;

		if (interpreter === null) {
			throw new Error('Parser interpreter is unavailable');
		}

		interpreter.predictionMode = mode;
		parser.sql_script();
		collect(parser);
		return parser;
	};
	const parser = parse(0);

	if (parser.numberOfSyntaxErrors > 0) {
		stream.seek(0);
		parse(1);
	}
}

function collect(parser: PlSqlParser): void {
	const info = parser.getParseInfo();

	if (info === undefined) {
		throw new Error('Profiling information is unavailable');
	}

	for (const decision of info.getDecisionInfo()) {
		add(decisions, decision.decision, {
			timeInPredictionMs: decision.timeInPrediction,
			invocations: decision.invocations,
			sllAtnTransitions: decision.sllATNTransitions,
			sllDfaTransitions: decision.sllDFATransitions,
			llAtnTransitions: decision.llATNTransitions,
			llDfaTransitions: decision.llDFATransitions,
			llFallbacks: decision.llFallback,
			ambiguities: decision.ambiguities.length,
		});
	}
}

function add<Key>(target: Map<Key, DecisionTotal>, key: Key, value: DecisionTotal): void {
	const total = target.get(key) ?? {
		timeInPredictionMs: 0,
		invocations: 0,
		sllAtnTransitions: 0,
		sllDfaTransitions: 0,
		llAtnTransitions: 0,
		llDfaTransitions: 0,
		llFallbacks: 0,
		ambiguities: 0,
	};
	total.timeInPredictionMs += value.timeInPredictionMs;
	total.invocations += value.invocations;
	total.sllAtnTransitions += value.sllAtnTransitions;
	total.sllDfaTransitions += value.sllDfaTransitions;
	total.llAtnTransitions += value.llAtnTransitions;
	total.llDfaTransitions += value.llDfaTransitions;
	total.llFallbacks += value.llFallbacks;
	total.ambiguities += value.ambiguities;
	target.set(key, total);
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
}
