import { spawn } from 'node:child_process';
import path from 'node:path';

import { benchmarkPolicy, type BenchmarkPolicy } from './benchmarkPolicy.ts';

const root = path.resolve(import.meta.dirname, '..');
const probeSource = "process.stdout.write(String(require('node:v8').getHeapStatistics().heap_size_limit))";

/**
 * Reads the effective V8 heap limit of a child runtime spawned the same way as
 * the TypeScript parser harness.
 *
 * The harness child inherits `NODE_OPTIONS` but not the parent's command-line
 * `--max-old-space-size` flag, so the parent limit is not a valid substitute.
 *
 * @param environment - Environment passed to the probe process.
 * @returns Effective limit in bytes.
 */
export const probeHeapLimitBytes = (environment: Readonly<Record<string, string | undefined>>): Promise<number> =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['-e', probeSource], {
			cwd: root,
			env: environment,
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
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Runtime heap probe failed (${String(code)}):\n${stderr}`));
				return;
			}

			const limit = Number(stdout.trim());

			if (!Number.isFinite(limit) || limit <= 0) {
				reject(new Error(`Runtime heap probe returned an invalid limit: ${stdout.trim()}`));
				return;
			}

			resolve(limit);
		});
	});

/**
 * Probes the TypeScript harness runtime and records its heap and DFA policy.
 *
 * @param environment - Environment visible to the harness.
 * @returns Benchmark execution identity.
 */
export const probeTypeScriptRuntime = async (environment: Readonly<Record<string, string | undefined>> = process.env): Promise<BenchmarkPolicy> => {
	const limitBytes = await probeHeapLimitBytes(environment);
	return benchmarkPolicy(environment['NODE_OPTIONS'], limitBytes, environment);
};
