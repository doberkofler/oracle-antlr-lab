import { cpus, release, totalmem } from 'node:os';
import { statistics } from './stats.ts';
import { type BenchmarkReport, type CorpusFile, type CorpusManifest, type ParsedFileRun, type ParserAdapter } from './types.ts';

const environment = (): BenchmarkReport['environment'] => ({
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	release: release(),
	cpuModel: cpus()[0]?.model ?? 'unknown',
	logicalCpus: cpus().length,
	totalMemoryBytes: totalmem(),
});

/**
 * Builds an aggregate report from completed file runs.
 *
 * @param input - Experiment identity, corpus, adapters, configuration, and runs.
 * @returns Complete report.
 */
export const buildReport = (
	input: Readonly<{
		experiment: string;
		hypothesis: string;
		manifest: CorpusManifest;
		adapters: readonly ParserAdapter[];
		config: BenchmarkReport['config'];
		perFile: readonly Readonly<{ file: CorpusFile; adapters: Readonly<Record<string, ParsedFileRun>> }>[];
		failures: BenchmarkReport['failures'];
	}>,
): BenchmarkReport => {
	const names = input.adapters.map((adapter) => adapter.identity.name);
	const aggregate: Record<string, Record<'cold' | 'coldAdapter' | 'coldSetup' | 'warm' | 'pass', ReturnType<typeof statistics>>> = {};

	for (const name of names) {
		const cold = input.perFile.flatMap((entry) => {
			const run = entry.adapters[name];
			return run === undefined ? [] : [run.cold.coreMs];
		});
		const coldAdapter = input.perFile.flatMap((entry) => {
			const run = entry.adapters[name];
			return run === undefined ? [] : [run.cold.adapterMs];
		});
		const coldSetup = input.perFile.flatMap((entry) => {
			const run = entry.adapters[name];
			return run === undefined ? [] : [run.cold.phases['setupMs'] ?? 0];
		});
		const warm = input.perFile.flatMap((entry) => {
			const run = entry.adapters[name];
			return run === undefined ? [] : run.warmSamples.map((sample) => sample.coreMs);
		});
		const pass = input.perFile.flatMap((entry) => {
			const run = entry.adapters[name];
			return run === undefined ? [] : [run.pass.coreMs];
		});

		aggregate[name] = {
			cold: statistics(cold),
			coldAdapter: statistics(coldAdapter),
			coldSetup: statistics(coldSetup),
			warm: statistics(warm),
			pass: statistics(pass),
		};
	}

	return {
		schemaVersion: 1,
		experiment: input.experiment,
		hypothesis: input.hypothesis,
		generatedAt: new Date().toISOString(),
		environment: environment(),
		corpus: {
			id: input.manifest.id,
			description: input.manifest.description,
			visibility: input.manifest.visibility,
			sourceFiles: input.manifest.sourceFiles,
			sourceBytes: input.manifest.sourceBytes,
			selection: input.manifest.selection,
			files: input.manifest.files,
		},
		adapters: input.adapters.map((adapter) => adapter.identity),
		config: input.config,
		aggregate,
		perFile: input.perFile,
		failures: input.failures,
	};
};

/**
 * Renders a compact Markdown summary for a report.
 *
 * @param report - Completed report.
 * @returns Markdown document.
 */
export const renderMarkdown = (report: BenchmarkReport): string => {
	const names = report.adapters.map((adapter) => adapter.name);
	const rows = names.map((name) => {
		const aggregate = report.aggregate[name];
		const cold = aggregate?.cold;
		const coldAdapter = aggregate?.coldAdapter;
		const coldSetup = aggregate?.coldSetup;
		const warm = aggregate?.warm;
		const pass = aggregate?.pass;

		const passTotal = pass === undefined ? undefined : pass.mean * pass.count;

		return `| ${name} | ${cold?.p50.toFixed(3) ?? '—'} | ${coldAdapter?.p50.toFixed(3) ?? '—'} | ${coldSetup?.p50.toFixed(3) ?? '—'} | ${warm?.p50.toFixed(3) ?? '—'} | ${passTotal?.toFixed(3) ?? '—'} | ${report.failures.filter((failure) => failure.adapter === name).length} |`;
	});

	return [
		`# ${report.experiment}`,
		'',
		report.hypothesis,
		'',
		`Generated ${report.generatedAt}`,
		'',
		`Corpus: ${report.corpus.id} — ${String(report.corpus.files.length)} of ${String(report.corpus.sourceFiles)} files, ${report.corpus.selection}.`,
		'',
		'| Adapter | Cold core p50 ms | Cold adapter p50 ms | Cold setup p50 ms | Warm core p50 ms | Pass core sum ms | Failures |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		...rows,
		'',
		`One-pass semantics: ${report.adapters.map((adapter) => `${adapter.name} — ${adapter.extra?.['onePass'] ?? 'per-file'}`).join('; ')}.`,
		'',
		'Treat every one-pass total as an approximation, not a full-build benchmark.',
		'',
		`Environment: ${report.environment.cpuModel}, ${String(report.environment.logicalCpus)} logical CPUs, ${report.environment.platform}/${report.environment.arch}, Node ${report.environment.node}.`,
		'',
	].join('\n');
};
