import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	assertLockedDigests,
	defaultStateRoot,
	materializeGrammarState,
	type MaterializedGrammarState,
	readGrammarStates,
	readGrammarStateLock,
	renderLock,
	stateByKey,
} from './grammarStateSource.ts';

const usage = `Usage: pnpm grammar:states [options]

Options:
  --states <keys>    all, or one/named comma-separated state keys (default: all)
  --output <path>    Materialization directory (default: .work/grammar-states)
  --check            Verify the checked-in digest lock instead of writing it
  --no-lock          Materialize without reading or writing the digest lock
  --help             Show this message
`;

const root = path.resolve(import.meta.dirname, '..');
const parsed = parseArguments(process.argv.slice(2));
const manifest = readGrammarStates(root);
const lock = readGrammarStateLock(root);

if (parsed.check && lock === undefined) {
	throw new Error('grammar/states.lock.json is required for --check');
}

const states = parsed.keys === 'all' ? manifest.states : parsed.keys.split(',').map((key) => stateByKey(manifest, key.trim()));
const cache = new Map<string, MaterializedGrammarState>();
const materialized: MaterializedGrammarState[] = [];

for (const state of states) {
	process.stdout.write(`Materializing ${state.key} (${state.ref ?? `merge of ${(state.merge ?? []).join(', ')}`}).\n`);
	const stateDirectory = path.join(parsed.output, state.key);
	mkdirSync(stateDirectory, { recursive: true });
	const result = await materializeGrammarState({ manifest, state, directory: stateDirectory, cache });

	if (!parsed.noLock && lock !== undefined) {
		assertLockedDigests(result, lock);
	}

	materialized.push(result);
	process.stdout.write(
		`${state.key}: adapted lexer ${result.digests.adapted.lexerSha256.slice(0, 12)}, parser ${result.digests.adapted.parserSha256.slice(0, 12)}.\n`,
	);
}

if (!parsed.check && !parsed.noLock) {
	if (parsed.keys !== 'all') {
		throw new Error('Writing the digest lock requires --states all; use --no-lock for a partial materialization');
	}

	writeFileSync(path.join(root, 'grammar', 'states.lock.json'), renderLock(materialized));
	process.stdout.write(`Wrote grammar/states.lock.json for ${String(materialized.length)} states.\n`);
}

function parseArguments(args: readonly string[]): Readonly<{ keys: string; output: string; check: boolean; noLock: boolean }> {
	let keys = 'all';
	let output = defaultStateRoot(root);
	let check = false;
	let noLock = false;

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

		if (argument === '--check') {
			check = true;
			continue;
		}

		if (argument === '--no-lock') {
			noLock = true;
			continue;
		}

		const value = args[index + 1];

		if (value === undefined) {
			throw new Error(`Missing value for ${argument}`);
		}

		switch (argument) {
			case '--states': {
				keys = value;
				break;
			}
			case '--output': {
				output = path.resolve(root, value);
				break;
			}
			default: {
				throw new Error(`Unknown argument: ${argument}`);
			}
		}

		index += 1;
	}

	return { keys, output, check, noLock };
}
