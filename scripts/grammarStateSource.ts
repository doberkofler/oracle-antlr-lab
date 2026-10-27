import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adaptGrammar, type AdaptedGrammar, GRAMMAR_PATHS, type GrammarSources, UPSTREAM_REPOSITORY } from './grammarAdaptation.ts';

/** One upstream grammar state recorded in grammar/states.json. */
export type GrammarStateDefinition = Readonly<{
	key: string;
	title: string;
	ref?: string;
	pullRequest?: number;
	base?: string;
	merge?: readonly string[];
}>;

/** Checked-in grammar-state catalogue. */
export type GrammarStatesManifest = Readonly<{
	schemaVersion: 1;
	upstream: string;
	states: readonly GrammarStateDefinition[];
}>;

/** Digest identity of one materialized grammar state. */
export type GrammarStateDigests = Readonly<{
	upstream: Readonly<{ lexerSha256: string; parserSha256: string; parserBaseSha256: string }>;
	adapted: Readonly<{ lexerSha256: string; parserSha256: string; lexerBaseSha256: string; parserBaseSha256: string }>;
}>;

/** Checked-in digest lock for every materialized state. */
export type GrammarStateLock = Readonly<{
	schemaVersion: 1;
	states: Readonly<Record<string, GrammarStateDigests>>;
}>;

/** Materialized grammar state and its verified identity. */
export type MaterializedGrammarState = Readonly<{
	definition: GrammarStateDefinition;
	sources: GrammarSources;
	adapted: AdaptedGrammar;
	digests: GrammarStateDigests;
	directory: string;
}>;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const readJson = (file: string): object => {
	const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));

	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error(`${file} must contain a JSON object`);
	}

	return parsed;
};

const requireString = (value: unknown, label: string): string => {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}

	return value;
};

/**
 * Reads and validates the checked-in grammar-state catalogue.
 *
 * @param root - Repository root.
 * @returns Parsed catalogue.
 * @throws Error when a state is malformed or duplicated.
 */
export const readGrammarStates = (root: string): GrammarStatesManifest => {
	const parsed = readJson(path.join(root, 'grammar', 'states.json'));
	const statesValue = Reflect.get(parsed, 'states');

	if (!Array.isArray(statesValue)) {
		throw new Error('grammar/states.json requires a states array');
	}

	const states = statesValue.map((state: unknown, index): GrammarStateDefinition => {
		if (typeof state !== 'object' || state === null) {
			throw new Error(`State ${String(index)} must be an object`);
		}

		const key = requireString(Reflect.get(state, 'key'), `State ${String(index)} key`);
		const title = requireString(Reflect.get(state, 'title'), `State ${key} title`);
		const ref = Reflect.get(state, 'ref');
		const pullRequest = Reflect.get(state, 'pullRequest');
		const base = Reflect.get(state, 'base');
		const merge = Reflect.get(state, 'merge');

		if (ref !== undefined && typeof ref !== 'string') {
			throw new Error(`State ${key} ref must be a string`);
		}

		if (pullRequest !== undefined && (typeof pullRequest !== 'number' || !Number.isInteger(pullRequest))) {
			throw new Error(`State ${key} pullRequest must be an integer`);
		}

		if (base !== undefined && typeof base !== 'string') {
			throw new Error(`State ${key} base must be a string`);
		}

		if (merge !== undefined && (!Array.isArray(merge) || merge.some((entry) => typeof entry !== 'string'))) {
			throw new Error(`State ${key} merge must be an array of state keys`);
		}

		return {
			key,
			title,
			...(ref === undefined ? {} : { ref }),
			...(pullRequest === undefined ? {} : { pullRequest }),
			...(base === undefined ? {} : { base }),
			...(merge === undefined ? {} : { merge: merge as readonly string[] }),
		};
	});

	const keys = states.map((state) => state.key);

	if (new Set(keys).size !== keys.length) {
		throw new Error('grammar/states.json contains duplicate state keys');
	}

	return {
		schemaVersion: 1,
		upstream: requireString(Reflect.get(parsed, 'upstream') ?? UPSTREAM_REPOSITORY, 'upstream'),
		states,
	};
};

/**
 * Finds one state by key.
 *
 * @param manifest - Checked-in catalogue.
 * @param key - Requested state key.
 * @returns State definition.
 * @throws Error when the key is unknown.
 */
export const stateByKey = (manifest: GrammarStatesManifest, key: string): GrammarStateDefinition => {
	const state = manifest.states.find((candidate) => candidate.key === key);

	if (state === undefined) {
		throw new Error(`Unknown grammar state: ${key}`);
	}

	return state;
};

const sleep = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchText = async (url: string): Promise<string> => {
	let lastError = '';

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await fetch(url);

			if (response.ok) {
				return await response.text();
			}

			lastError = `${String(response.status)} ${response.statusText}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}

		await sleep(250 * attempt);
	}

	throw new Error(`Unable to download ${url}: ${lastError}`);
};

const fetchRefSources = async (upstream: string, ref: string): Promise<GrammarSources> => {
	const base = `https://raw.githubusercontent.com/${upstream}/${ref}`;
	const [lexer, parser, parserBase] = await Promise.all([
		fetchText(`${base}/${GRAMMAR_PATHS.lexer}`),
		fetchText(`${base}/${GRAMMAR_PATHS.parser}`),
		fetchText(`${base}/${GRAMMAR_PATHS.parserBase}`),
	]);

	return { lexer, parser, parserBase };
};

type SourceFile = keyof GrammarSources;

const SOURCE_FILES: readonly Readonly<{ name: SourceFile; file: string }>[] = [
	{ name: 'lexer', file: 'PlSqlLexer.g4' },
	{ name: 'parser', file: 'PlSqlParser.g4' },
	{ name: 'parserBase', file: 'PlSqlParserBase.ts' },
];

const mergeSources = (base: GrammarSources, current: GrammarSources, head: GrammarSources, scratchDirectory: string): GrammarSources => {
	mkdirSync(scratchDirectory, { recursive: true });
	const merged: Record<SourceFile, string> = { lexer: '', parser: '', parserBase: '' };

	for (const source of SOURCE_FILES) {
		const basePath = path.join(scratchDirectory, `base-${source.file}`);
		const currentPath = path.join(scratchDirectory, `current-${source.file}`);
		const headPath = path.join(scratchDirectory, `head-${source.file}`);
		writeFileSync(basePath, base[source.name]);
		writeFileSync(currentPath, current[source.name]);
		writeFileSync(headPath, head[source.name]);

		const result = spawnSync('git', ['merge-file', '-p', currentPath, basePath, headPath], { encoding: 'utf8' });

		if (result.status !== 0) {
			throw new Error(`Grammar state merge failed for ${source.file} (conflicts: ${String(result.status)})`);
		}

		merged[source.name] = result.stdout;
	}

	return merged;
};

/**
 * Materializes one upstream state, applying the laboratory adaptations.
 *
 * For merged states, every input is three-way merged against the declared base
 * so an ordered cumulative candidate is reproducible without hand editing.
 *
 * @param input - Catalogue, state, and output location.
 * @returns Adapted files plus verified digests.
 */
export const materializeGrammarState = async (
	input: Readonly<{
		manifest: GrammarStatesManifest;
		state: GrammarStateDefinition;
		directory: string;
		cache: Map<string, MaterializedGrammarState>;
	}>,
): Promise<MaterializedGrammarState> => {
	const cached = input.cache.get(input.state.key);

	if (cached !== undefined) {
		return cached;
	}

	if (input.state.merge !== undefined) {
		const baseKey = input.state.base;

		if (baseKey === undefined) {
			throw new Error(`Merged state ${input.state.key} requires a base state`);
		}

		const base = await materializeGrammarState({
			...input,
			state: stateByKey(input.manifest, baseKey),
			directory: path.join(path.dirname(input.directory), baseKey),
		});
		let sources = base.sources;

		for (const sourceKey of input.state.merge) {
			const head = await materializeGrammarState({
				...input,
				state: stateByKey(input.manifest, sourceKey),
				directory: path.join(path.dirname(input.directory), sourceKey),
			});
			sources = mergeSources(base.sources, sources, head.sources, path.join(input.directory, '.merge', sourceKey));
		}

		return finishMaterialization(input, sources);
	}

	if (input.state.ref === undefined) {
		throw new Error(`State ${input.state.key} requires a ref or a merge declaration`);
	}

	return finishMaterialization(input, await fetchRefSources(input.manifest.upstream, input.state.ref));
};

const finishMaterialization = (
	input: Readonly<{
		manifest: GrammarStatesManifest;
		state: GrammarStateDefinition;
		directory: string;
		cache: Map<string, MaterializedGrammarState>;
	}>,
	sources: GrammarSources,
): MaterializedGrammarState => {
	const adapted = adaptGrammar(sources);
	const digests: GrammarStateDigests = {
		upstream: {
			lexerSha256: sha256(sources.lexer),
			parserSha256: sha256(sources.parser),
			parserBaseSha256: sha256(sources.parserBase),
		},
		adapted: {
			lexerSha256: sha256(adapted.lexer),
			parserSha256: sha256(adapted.parser),
			lexerBaseSha256: sha256(adapted.lexerBase),
			parserBaseSha256: sha256(adapted.parserBase),
		},
	};

	const upstreamDirectory = path.join(input.directory, 'upstream');
	rmSync(upstreamDirectory, { recursive: true, force: true });
	rmSync(path.join(input.directory, '.merge'), { recursive: true, force: true });
	mkdirSync(upstreamDirectory, { recursive: true });

	for (const source of SOURCE_FILES) {
		writeFileSync(path.join(upstreamDirectory, source.file), sources[source.name]);
	}

	writeFileSync(path.join(input.directory, 'PlSqlLexer.g4'), adapted.lexer);
	writeFileSync(path.join(input.directory, 'PlSqlParser.g4'), adapted.parser);
	writeFileSync(path.join(input.directory, 'plSqlLexerBase.ts'), adapted.lexerBase);
	writeFileSync(path.join(input.directory, 'plSqlParserBase.ts'), adapted.parserBase);
	const materialized: MaterializedGrammarState = { definition: input.state, sources, adapted, digests, directory: input.directory };
	writeFileSync(
		path.join(input.directory, 'state.json'),
		`${JSON.stringify({ key: input.state.key, title: input.state.title, definition: input.state, digests }, null, '\t')}\n`,
	);
	input.cache.set(input.state.key, materialized);

	return materialized;
};

/**
 * Reads the digest lock, if present.
 *
 * @param root - Repository root.
 * @returns Lock contents or undefined when the file does not exist yet.
 */
export const readGrammarStateLock = (root: string): GrammarStateLock | undefined => {
	const file = path.join(root, 'grammar', 'states.lock.json');

	if (!existsSync(file)) {
		return undefined;
	}

	const parsed = readJson(file);
	const states = Reflect.get(parsed, 'states');

	if (typeof states !== 'object' || states === null) {
		throw new Error('grammar/states.lock.json requires a states object');
	}

	return { schemaVersion: 1, states: states as Readonly<Record<string, GrammarStateDigests>> };
};

/**
 * Compares one materialized state with the checked-in lock.
 *
 * @param state - Materialized state.
 * @param lock - Checked-in lock.
 * @throws Error when any recorded digest differs.
 */
export const assertLockedDigests = (state: MaterializedGrammarState, lock: GrammarStateLock): void => {
	const expected = lock.states[state.definition.key];

	if (expected === undefined) {
		throw new Error(`grammar/states.lock.json has no entry for ${state.definition.key}`);
	}

	for (const scope of ['upstream', 'adapted'] as const) {
		for (const [name, digest] of Object.entries(state.digests[scope])) {
			const recorded = Reflect.get(expected[scope], name);

			if (recorded !== digest) {
				throw new Error(`Grammar state ${state.definition.key} ${scope}.${name} digest mismatch: locked ${String(recorded)}, materialized ${digest}`);
			}
		}
	}
};

/**
 * Renders the digest lock for a set of materialized states.
 *
 * @param states - Materialized states.
 * @returns Lock file contents.
 */
export const renderLock = (states: readonly MaterializedGrammarState[]): string => {
	const lock: GrammarStateLock = {
		schemaVersion: 1,
		states: Object.fromEntries(states.map((state) => [state.definition.key, state.digests])),
	};

	return `${JSON.stringify(lock, null, '\t')}\n`;
};

/**
 * Scratch directory for generated grammar states inside the workspace.
 *
 * @param root - Repository root.
 * @returns Absolute path outside the committed grammar directories.
 */
export const defaultStateRoot = (root: string): string => path.join(root, '.work', 'grammar-states');
