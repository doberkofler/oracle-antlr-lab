import { spawn } from 'node:child_process';
import path from 'node:path';
import { type ParseObservation, type ParserAdapter } from '../types.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const harness = path.join(root, 'grammar', 'typescript', 'harness.ts');

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
 * TypeScript parser-core adapter.
 */
export const typeScriptAdapter: ParserAdapter = {
	identity: {
		name: 'typescript',
		language: 'TypeScript',
		grammar: 'pinned grammars-v4 plus local adaptations',
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
		const output = await invoke({ ...input, stage: 'pass', iterations: 0, warmups: 0 });
		return new Map(output.files.map((entry) => [entry.observation.file, entry.observation]));
	},
	available: async () => true,
};
