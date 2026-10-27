import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	assertLockedDigests,
	materializeGrammarState,
	type GrammarStateDefinition,
	type GrammarStateLock,
	type GrammarStatesManifest,
	type MaterializedGrammarState,
} from './grammarStateSource.ts';

/** A materialized grammar state with its generated TypeScript recognizers. */
export type PreparedGrammarState = Readonly<{
	materialized: MaterializedGrammarState;
	generatedDirectory: string;
}>;

/**
 * Generates the TypeScript recognizers for one materialized grammar state.
 *
 * Generation is skipped when the marker still matches the adapted digests, so
 * repeated conformance and benchmark runs reuse the same generated code.
 *
 * @param materialized - Adapted grammar state.
 * @param regenerate - Force generation even when the marker matches.
 * @param root - Repository root.
 * @returns Prepared state with the generated directory.
 */
export const prepareGrammarState = (materialized: MaterializedGrammarState, regenerate: boolean, root: string): PreparedGrammarState => {
	const generatedDirectory = path.join(materialized.directory, 'generated');
	const marker = path.join(generatedDirectory, 'grammar-digest');
	const identity = JSON.stringify(materialized.digests.adapted);

	if (!regenerate && existsSync(marker) && readFileSync(marker, 'utf8') === identity) {
		return { materialized, generatedDirectory };
	}

	rmSync(generatedDirectory, { recursive: true, force: true });
	const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'generate-typescript.ts')], {
		cwd: root,
		env: {
			...process.env,
			LAB_GRAMMAR_DIR: materialized.directory,
			LAB_GENERATED_OUTPUT: generatedDirectory,
		},
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		throw new Error(`Generated parser state ${materialized.definition.key} failed:\n${result.stderr}`);
	}

	writeFileSync(marker, identity);
	return { materialized, generatedDirectory };
};

/**
 * Materializes and prepares a set of grammar states, verifying the digest lock.
 *
 * @param input - Catalogue, state definitions, output root, and options.
 * @returns Prepared states in request order.
 */
export const prepareGrammarStates = async (
	input: Readonly<{
		root: string;
		manifest: GrammarStatesManifest;
		lock: GrammarStateLock;
		states: readonly GrammarStateDefinition[];
		stateRoot: string;
		regenerate: boolean;
	}>,
): Promise<readonly PreparedGrammarState[]> => {
	const cache = new Map<string, MaterializedGrammarState>();
	const prepared: PreparedGrammarState[] = [];

	for (const state of input.states) {
		const directory = path.join(input.stateRoot, state.key);
		mkdirSync(directory, { recursive: true });
		const materialized = await materializeGrammarState({ manifest: input.manifest, state, directory, cache });
		assertLockedDigests(materialized, input.lock);
		prepared.push(prepareGrammarState(materialized, input.regenerate, input.root));
		process.stdout.write(`Prepared ${state.key}: adapted parser ${materialized.digests.adapted.parserSha256.slice(0, 12)}.\n`);
	}

	return prepared;
};
