import { spawn } from 'node:child_process';
import path from 'node:path';
import { type MemoryPassBody } from '../memory.ts';
import { type ParseObservation, type ParserAdapter } from '../types.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'grammar', 'typescript', 'harness.ts');
const memoryHarness = path.join(root, 'grammar', 'typescript', 'memoryHarness.ts');

type HarnessOutput = Readonly<{ stage: string; files: readonly Readonly<{ observation: ParseObservation }>[] }>;

const invoke = (
	input: Readonly<{
		manifestPath: string;
		filesDir: string;
		stage: 'cold' | 'warm' | 'pass';
		index?: number;
		ids?: readonly number[];
		iterations: number;
		warmups: number;
	}>,
): Promise<HarnessOutput> =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [harness], {
			cwd: root,
			env: {
				...process.env,
				LAB_MANIFEST: input.manifestPath,
				LAB_FILES: input.filesDir,
				LAB_STAGE: input.stage,
				...(input.index === undefined ? {} : { LAB_INDEX: String(input.index) }),
				...(input.ids === undefined ? {} : { LAB_IDS: input.ids.join(',') }),
				LAB_ITERATIONS: String(input.iterations),
				LAB_WARMUPS: String(input.warmups),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;

			if (input.stage === 'pass') {
				process.stderr.write(`[typescript] ${chunk}`);
			}
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`TypeScript harness failed (${String(code)}):\n${stderr}`));
				return;
			}

			const start = stdout.indexOf('{');
			if (start < 0) {
				reject(new Error(`No JSON from TypeScript harness:\n${stdout}`));
				return;
			}

			resolve(JSON.parse(stdout.slice(start)) as HarnessOutput);
		});
	});

/**
 * Runs the TypeScript memory harness in a fresh garbage-collectable process.
 *
 * @param input - Manifest, opaque selection ids, and optional artifact paths.
 * @returns Instrumented memory pass.
 */
export const runTypeScriptMemory = async (
	input: Readonly<{
		manifestPath: string;
		filesDir: string;
		indexes: readonly number[];
		gcEvery: number;
		samplingIntervalBytes?: number | undefined;
		allocationProfilePath?: string | undefined;
		treeIndex?: number | undefined;
	}>,
): Promise<MemoryPassBody> => {
	const body = await new Promise<MemoryPassBody>((resolve, reject) => {
		const child = spawn(process.execPath, ['--expose-gc', '--max-old-space-size=8192', memoryHarness], {
			cwd: root,
			env: {
				...process.env,
				LAB_MANIFEST: input.manifestPath,
				LAB_FILES: input.filesDir,
				LAB_IDS: input.indexes.join(','),
				LAB_GC_EVERY: String(input.gcEvery),
				...(input.samplingIntervalBytes === undefined ? {} : { LAB_SAMPLING_INTERVAL: String(input.samplingIntervalBytes) }),
				...(input.allocationProfilePath === undefined ? {} : { LAB_ALLOCATION_PROFILE: input.allocationProfilePath }),
				...(input.treeIndex === undefined ? {} : { LAB_TREE_INDEX: String(input.treeIndex) }),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
			process.stderr.write(`[typescript-memory] ${chunk}`);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`TypeScript memory harness failed (${String(code)}):\n${stderr}`));
				return;
			}

			const start = stdout.indexOf('{');

			if (start < 0) {
				reject(new Error(`No JSON from TypeScript memory harness:\n${stdout}`));
				return;
			}

			resolve(JSON.parse(stdout.slice(start)) as MemoryPassBody);
		});
	});
	return body;
};

/**
 * TypeScript parser-core adapter.
 */
export const typeScriptAdapter: ParserAdapter = {
	identity: {
		name: 'typescript',
		language: 'TypeScript',
		grammar: 'pinned official grammars-v4 with TypeScript target imports',
		runtime: 'antlr4ng@3.0.16',
		generator: 'antlr-ng@1.0.10',
		extra: {
			metric: 'lexer + SLL-first parse with LL fallback',
			process: 'fresh Node.js process per stage; process startup and generated-module initialization are not timed',
			onePass: 'one process; parser instances are per file; generated lexer/parser DFA caches persist across files',
		},
	},
	run: async (input) => {
		const cold = (await invoke({ ...input, stage: 'cold' })).files[0]?.observation;
		const warm = (await invoke({ ...input, stage: 'warm' })).files[0]?.observation;
		const pass = (await invoke({ ...input, stage: 'pass' })).files[0]?.observation;

		if (cold === undefined || warm === undefined || pass === undefined) {
			throw new Error(`TypeScript harness returned no observation for index ${String(input.index)}`);
		}

		return { cold, warm, pass };
	},
	runPass: async (input) => {
		const output = await invoke({
			manifestPath: input.manifestPath,
			filesDir: input.filesDir,
			stage: 'pass',
			ids: input.indexes,
			iterations: 0,
			warmups: 0,
		});
		return new Map(output.files.map((entry) => [entry.observation.file, entry.observation]));
	},
	available: async () => true,
};
