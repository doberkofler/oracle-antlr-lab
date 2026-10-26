import path from 'node:path';
import { buildManifest } from '../src/corpus.ts';

const usage = `Usage: pnpm corpus:select -- --root <source-root> --output <output-dir> [options]

Options:
  --root <path>          Oracle source root
  --output <path>        Output directory for manifest.json and files/
  --id <name>            Corpus id (default: private-source)
  --description <text>   Corpus description
  --visibility <value>   private or public (default: private)
  --files <n>            Size-quantile sample size (default: 40)
`;

const options = {
	sourceRoot: '',
	output: '',
	id: 'private-source',
	description: 'Private Oracle source selection. Only aggregates are published.',
	visibility: 'private' as 'private' | 'public',
	limit: 40,
};

const args = process.argv.slice(2);

if (args.includes('--help')) {
	process.stdout.write(usage);
	process.exit(0);
}

for (let index = 0; index < args.length; index += 1) {
	const argument = args[index];
	const value = args[index + 1];

	if (value === undefined) {
		throw new Error(`Missing value for ${String(argument)}`);
	}

	switch (argument) {
		case '--root': {
			options.sourceRoot = path.resolve(value);
			break;
		}
		case '--output': {
			options.output = path.resolve(value);
			break;
		}
		case '--id': {
			options.id = value;
			break;
		}
		case '--description': {
			options.description = value;
			break;
		}
		case '--visibility': {
			if (value !== 'private' && value !== 'public') {
				throw new Error('--visibility must be private or public');
			}

			options.visibility = value;
			break;
		}
		case '--files': {
			options.limit = Number(value);
			break;
		}
		default: {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}

	index += 1;
}

if (options.sourceRoot === '' || options.output === '') {
	throw new Error('--root and --output are required');
}

if (!Number.isInteger(options.limit) || options.limit < 1) {
	throw new Error('--files must be a positive integer');
}

const manifest = buildManifest({ ...options, outputRoot: options.output });
process.stdout.write(
	`Corpus ${manifest.id}: ${String(manifest.files.length)} files, ${String(manifest.sourceBytes)} bytes\nManifest: ${path.join(options.output, 'manifest.json')}\n`,
);
