import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadManifest } from '../src/corpus.ts';
import { buildReport, renderMarkdown } from '../src/report.ts';
import { runFile } from '../src/runner.ts';
import { typeScriptAdapter } from '../src/adapters/typescript.ts';
import { javaAdapter } from '../src/adapters/java.ts';
import { type ParserAdapter } from '../src/types.ts';

const usage = `Usage: pnpm benchmark [options]

Options:
  --manifest <path>       Corpus manifest (default: corpora/public/manifest.json)
  --files <n>             Deterministic size-quantile sample size
  --adapters <list>       Comma-separated adapters: typescript,java (default: typescript)
  --iterations <n>        Warm samples per file (default: 5)
  --warmups <n>           Warm warmups per file (default: 1)
  --cold-repeats <n>      Fresh-process cold repetitions per file (default: 3)
  --experiment <name>     Report directory name
  --hypothesis <text>     One-sentence claim the run tests
  --help                  Show this message
`;

const root = path.resolve(import.meta.dirname, '..');
const options = {
	manifest: path.join(root, 'corpora', 'public', 'manifest.json'),
	files: undefined as number | undefined,
	adapters: ['typescript'],
	iterations: 5,
	warmups: 1,
	coldRepeats: 3,
	experiment: 'baseline',
	hypothesis: 'The pinned TypeScript recognizer establishes a reproducible baseline for this corpus.',
};

const args = process.argv.slice(2);

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

	if (!argument.startsWith('--') || value === undefined) {
		throw new Error(`Unknown or incomplete argument: ${String(argument)}`);
	}

	switch (argument) {
		case '--manifest': {
			options.manifest = path.resolve(value);
			break;
		}
		case '--files': {
			options.files = positiveInteger(argument, value);
			break;
		}
		case '--iterations': {
			options.iterations = positiveInteger(argument, value);
			break;
		}
		case '--warmups': {
			const warmups = Number(value);

			if (!Number.isInteger(warmups) || warmups < 0) {
				throw new Error('--warmups requires a non-negative integer');
			}

			options.warmups = warmups;
			break;
		}
		case '--cold-repeats': {
			options.coldRepeats = positiveInteger(argument, value);
			break;
		}
		case '--adapters': {
			options.adapters = value.split(',').map((name) => name.trim());
			break;
		}
		case '--experiment': {
			options.experiment = value;
			break;
		}
		case '--hypothesis': {
			options.hypothesis = value;
			break;
		}
		default: {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}

	index += 1;
}

function positiveInteger(argument: string, value: string): number {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${argument} requires a positive integer`);
	}

	return parsed;
}

const available: Readonly<Record<string, ParserAdapter>> = { typescript: typeScriptAdapter, java: javaAdapter };
const adapters: ParserAdapter[] = options.adapters.map((name) => {
	const adapter = available[name];

	if (adapter === undefined) {
		throw new Error(`Unknown adapter: ${name}`);
	}

	return adapter;
});
const manifestPath = path.resolve(options.manifest);
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files } = loadManifest(manifestPath, filesDir, options.files);
const selected: ParserAdapter[] = [];
const failures: { adapter: string; file: string; message: string }[] = [];

for (const adapter of adapters) {
	if (await adapter.available()) {
		selected.push(adapter);
	} else {
		failures.push({ adapter: adapter.identity.name, file: '*', message: 'Adapter runtime unavailable' });
	}
}

if (selected.length === 0) {
	throw new Error('No requested adapter is available');
}

const perFile: { file: (typeof files)[number]; adapters: Record<string, import('../src/types.ts').ParsedFileRun> }[] = [];

for (const [position, file] of files.entries()) {
	process.stdout.write(`[${String(position + 1)}/${String(files.length)}] ${file.path}\n`);
	const result = await runFile({
		file,
		adapters: Object.fromEntries(selected.map((adapter) => [adapter.identity.name, adapter])),
		manifestPath,
		filesDir,
		config: { iterations: options.iterations, warmups: options.warmups, coldRepeats: options.coldRepeats },
	});
	perFile.push({ file, adapters: result.runs });
	failures.push(...result.failures);
}

// A shared pass must run once per adapter, not once per file.
for (const adapter of selected) {
	if (adapter.runPass === undefined) {
		continue;
	}

	const observations = await adapter.runPass({ manifestPath, filesDir, indexes: files.map((file) => file.id) });

	for (const entry of perFile) {
		const run = entry.adapters[adapter.identity.name];

		if (run === undefined) {
			continue;
		}

		entry.adapters[adapter.identity.name] = { ...run, pass: observations.get(entry.file.path) ?? run.pass };
	}
}

const report = buildReport({
	experiment: options.experiment,
	hypothesis: options.hypothesis,
	manifest,
	adapters: selected,
	config: { iterations: options.iterations, warmups: options.warmups, coldRepeats: options.coldRepeats, defaultSchema: 'BENCH' },
	perFile,
	failures,
});
const directory = path.join(root, 'results', options.experiment);

mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(directory, 'report.md'), renderMarkdown(report));

process.stdout.write(`\nReport: ${path.relative(root, directory)}/report.md\n`);

for (const [name, aggregate] of Object.entries(report.aggregate)) {
	process.stdout.write(
		`${name}: cold core p50 ${aggregate.cold.p50.toFixed(3)} ms, cold adapter p50 ${aggregate.coldAdapter.p50.toFixed(3)} ms, setup p50 ${aggregate.coldSetup.p50.toFixed(3)} ms, warm p50 ${aggregate.warm.p50.toFixed(3)} ms, pass sum ${(aggregate.pass.mean * aggregate.pass.count).toFixed(3)} ms\n`,
	);
}
