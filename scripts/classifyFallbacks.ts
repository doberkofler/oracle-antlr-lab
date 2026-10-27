import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { statistics } from '../src/stats.ts';
import { type ParseObservation } from '../src/types.ts';

type ProductionReport = Readonly<{
	experiment: string;
	corpus: Readonly<{ id: string }>;
	runs: Readonly<Record<string, readonly Readonly<{ files: readonly ParseObservation[] }>[]>>;
}>;

const root = path.resolve(import.meta.dirname, '..');
const reportPath = path.resolve(process.argv[2] ?? path.join(root, 'results', 'official-grammar-production', 'raw-report.json'));
const outputPath = path.resolve(process.argv[3] ?? path.join(root, 'results', 'official-grammar-fallbacks.json'));
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ProductionReport;
const runs = report.runs['typescript'];

if (runs === undefined || runs.length === 0) {
	throw new Error('Production report has no TypeScript runs');
}

const passes = runs.map((run) => {
	const fallback = run.files.filter((observation) => observation.llAttempts > 0);
	return {
		files: fallback.length,
		accepted: fallback.filter((observation) => observation.lexerDiagnostics === 0 && observation.parseDiagnostics === 0).length,
		rejected: fallback.filter((observation) => observation.lexerDiagnostics > 0 || observation.parseDiagnostics > 0).length,
		sllParseMs: fallback.reduce((total, observation) => total + (observation.phases['sllParseMs'] ?? 0), 0),
		llParseMs: fallback.reduce((total, observation) => total + (observation.phases['llParseMs'] ?? 0), 0),
		coreMs: fallback.reduce((total, observation) => total + observation.coreMs, 0),
	};
});
const result = {
	schemaVersion: 1,
	experiment: 'official-grammar-fallback-classification',
	sourceExperiment: report.experiment,
	corpus: report.corpus.id,
	passes: passes.length,
	files: statistics(passes.map((pass) => pass.files)),
	accepted: statistics(passes.map((pass) => pass.accepted)),
	rejected: statistics(passes.map((pass) => pass.rejected)),
	sllParseMs: statistics(passes.map((pass) => pass.sllParseMs)),
	llParseMs: statistics(passes.map((pass) => pass.llParseMs)),
	coreMs: statistics(passes.map((pass) => pass.coreMs)),
};

writeFileSync(outputPath, `${JSON.stringify(result, null, '\t')}\n`);
process.stdout.write(
	`Fallback classification: ${String(result.files.mean)} files; ${String(result.accepted.mean)} accepted; ${String(result.rejected.mean)} rejected.\n`,
);
