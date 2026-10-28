import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runJavaProfile } from '../src/adapters/java.ts';
import { createProgressReporter, formatDuration } from '../src/progress.ts';
import { median } from '../src/stats.ts';
import { type ParseObservation } from '../src/types.ts';

type ProductionReport = Readonly<{
	corpus: Readonly<{ files: readonly Readonly<{ id: number; path: string; bytes: number; sha256: string }>[] }>;
	runs: Readonly<Record<string, readonly Readonly<{ files: readonly ParseObservation[] }>[]>>;
}>;

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, '.work', 'private-production', 'manifest.json'));
const productionReportPath = path.resolve(process.argv[3] ?? path.join(root, 'results', '003-production-scale', 'raw-report.json'));
const outputPath = path.resolve(process.argv[4] ?? path.join(root, 'results', '004-bottleneck-profile.json'));
const report = JSON.parse(readFileSync(productionReportPath, 'utf8')) as ProductionReport;
const typeScriptRuns = report.runs['typescript'];

if (typeScriptRuns === undefined || typeScriptRuns.length === 0) {
	throw new Error('Production report has no TypeScript runs');
}

const selected = report.corpus.files
	.map((file) => ({
		...file,
		medianCoreMs: median(typeScriptRuns.map((run) => run.files[file.id]?.coreMs ?? 0)),
	}))
	.sort((left, right) => right.medianCoreMs - left.medianCoreMs)
	.slice(0, 12);

process.stdout.write('Profiling the 12 highest-cost opaque files.\n');
const startedAt = performance.now();
const progress = createProgressReporter({ label: 'java profile', total: selected.length, unit: 'files' });
const profile = await runJavaProfile({ manifestPath, indexes: selected.map((file) => file.id) }, (completed) => {
	progress.advance(completed, 'profiling');
});
progress.finish();
const result = {
	schemaVersion: 1,
	experiment: '004-bottleneck-profile',
	generatedAt: new Date().toISOString(),
	selection: '12 files with highest median TypeScript parser-core time in experiment 003',
	files: selected,
	profile,
	elapsedMs: performance.now() - startedAt,
};

writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`Profile complete in ${formatDuration(result.elapsedMs)}: ${path.relative(root, outputPath)}\n`);
