import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { type CorpusManifest, type ParseObservation, type ParserAdapter } from '../types.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const image = 'oracle-antlr-lab-java:0.1.0';

const docker = (args: readonly string[], inherit = false): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn('docker', args, { cwd: root, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';

		if (!inherit && child.stdout !== null && child.stderr !== null) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.on('data', (chunk: string) => {
				stderr += chunk;
			});
		}

		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`docker ${args.join(' ')} failed (${String(code)}):\n${stderr}`));
				return;
			}

			resolve(stdout);
		});
	});

const ensureImage = async (): Promise<void> => {
	const exists = await docker(['image', 'inspect', image]).then(
		() => true,
		() => false,
	);

	if (!exists) {
		await docker(['build', '-f', path.join(root, 'java', 'Dockerfile'), '-t', image, '.'], true);
	}
};

const runJava = async (
	input: Readonly<{ manifestPath: string; index: number; iterations: number; warmups: number; mode: 'cold' | 'warm' }>,
): Promise<ParseObservation> => {
	const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
	const entry = manifest.files.find((file) => file.id === input.index);

	if (entry === undefined) {
		throw new Error(`No corpus entry with index ${String(input.index)}`);
	}

	const corpusRoot = path.dirname(input.manifestPath);
	const output = await docker([
		'run',
		'--rm',
		'--network',
		'none',
		'-v',
		`${corpusRoot}:/corpus:ro`,
		image,
		`/corpus/files/${entry.file}`,
		String(input.iterations),
		String(input.warmups),
		input.mode,
	]);
	const parsed = JSON.parse(output.slice(output.indexOf('{'))) as Omit<ParseObservation, 'file'>;

	return { ...parsed, file: entry.path };
};

/**
 * Java-target adapter.
 *
 * Docker isolates a JVM per process. The one-pass value is a per-file pass, not
 * a shared corpus pass; the adapter identity records that limitation.
 */
export const javaAdapter: ParserAdapter = {
	identity: {
		name: 'java',
		language: 'Java',
		grammar: 'pinned upstream grammars-v4, unmodified target',
		runtime: 'antlr4-runtime 4.13.2',
		generator: 'antlr4-maven-plugin 4.13.2',
		extra: { metric: 'lexer + SLL parse', process: 'fresh Docker JVM per file', onePass: 'one JVM over selected files; parser instance per file' },
	},
	run: async (input) => {
		await ensureImage();
		const cold = await runJava({ ...input, mode: 'cold' });
		const warm = await runJava({ ...input, mode: 'warm' });
		return { cold, warm, pass: cold };
	},
	runPass: async (input) => {
		await ensureImage();
		const manifest = JSON.parse(readFileSync(input.manifestPath, 'utf8')) as CorpusManifest;
		const corpusRoot = path.dirname(input.manifestPath);
		const byId = new Map(manifest.files.map((file) => [file.id, file]));
		const paths = input.indexes.map((index) => {
			const entry = byId.get(index);

			if (entry === undefined) {
				throw new Error(`No corpus entry with index ${String(index)}`);
			}

			return `/corpus/files/${entry.file}`;
		});
		const output = await docker(['run', '--rm', '--network', 'none', '-v', `${corpusRoot}:/corpus:ro`, image, 'pass', ...paths]);
		const parsed = JSON.parse(output.slice(output.indexOf('{'))) as Readonly<{
			files: readonly (Omit<ParseObservation, 'file'> & { file: string })[];
		}>;

		return new Map(
			parsed.files.map((entry) => [
				path.relative('/corpus/files', entry.file).split(path.sep).join('/'),
				{ ...entry, file: path.relative('/corpus/files', entry.file) },
			]),
		);
	},
	available: async () =>
		docker(['info', '--format', '{{.ServerVersion}}']).then(
			() => true,
			() => false,
		),
};
