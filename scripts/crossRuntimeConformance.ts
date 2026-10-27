import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runJavaConformance, type JavaConformanceObservation } from '../src/adapters/java.ts';
import { assertOpaqueIdentities } from '../src/conformance.ts';
import { loadManifest } from '../src/corpus.ts';

type TypeScriptObservation = JavaConformanceObservation & Readonly<{ accepted: boolean }>;
type HarnessOutput = Readonly<{ files: readonly Readonly<{ observation: TypeScriptObservation }>[] }>;

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, '.work', 'private-production', 'manifest.json'));
const experiment = process.argv[3] ?? 'java-requalification';
const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files } = loadManifest(manifestPath, filesDir);

assertOpaqueIdentities(manifest.visibility, files);

const [typeScript, java] = await Promise.all([runTypeScript(), runJavaConformance({ manifestPath, indexes: files.map((file) => file.id) })]);
const javaByFile = new Map(java.map((observation) => [observation.file, observation]));
const differences = files.flatMap((file, index) => {
	const left = typeScript[index];
	const right = javaByFile.get(file.path);

	if (left === undefined || right === undefined) {
		throw new Error(`Missing cross-runtime observation for ${file.path}`);
	}

	const changedFields = ['parseTreeSha256', 'lexerDiagnostics', 'parseDiagnostics', 'tokens', 'hiddenTokens'] as const;
	const changed = changedFields.filter((field) => left[field] !== right[field]);
	return changed.length === 0 ? [] : [{ file: file.path, bytes: file.bytes, sha256: file.sha256, changedFields: changed }];
});
const totals = {
	typeScriptAccepted: typeScript.filter((observation) => observation.lexerDiagnostics === 0 && observation.parseDiagnostics === 0).length,
	javaAccepted: java.filter((observation) => observation.lexerDiagnostics === 0 && observation.parseDiagnostics === 0).length,
	typeScriptDiagnostics: typeScript.reduce((total, observation) => total + observation.lexerDiagnostics + observation.parseDiagnostics, 0),
	javaDiagnostics: java.reduce((total, observation) => total + observation.lexerDiagnostics + observation.parseDiagnostics, 0),
	typeScriptFallbacks: typeScript.filter((observation) => observation.llAttempts > 0).length,
	javaFallbacks: java.filter((observation) => observation.llAttempts > 0).length,
};
const report = {
	schemaVersion: 1,
	experiment,
	generatedAt: new Date().toISOString(),
	corpus: { id: manifest.id, visibility: manifest.visibility, files: files.length, bytes: manifest.sourceBytes },
	javaInput: 'conditional-prepared',
	status: differences.length === 0 ? 'pass' : 'fail',
	identical: files.length - differences.length,
	different: differences.length,
	totals,
	differences,
};
const resultsDirectory = path.join(root, 'results', experiment);
mkdirSync(resultsDirectory, { recursive: true });
writeFileSync(path.join(resultsDirectory, 'conformance.json'), `${JSON.stringify(report, null, '\t')}\n`);
writeFileSync(
	path.join(resultsDirectory, 'conformance.md'),
	`# ${experiment}\n\nStatus: **${report.status}**. ${String(report.identical)} identical; ${String(report.different)} different. Java input: **${report.javaInput}**.\n\n| Runtime | Accepted files | Diagnostics | LL fallback files |\n| --- | ---: | ---: | ---: |\n| TypeScript | ${String(totals.typeScriptAccepted)} | ${String(totals.typeScriptDiagnostics)} | ${String(totals.typeScriptFallbacks)} |\n| Java | ${String(totals.javaAccepted)} | ${String(totals.javaDiagnostics)} | ${String(totals.javaFallbacks)} |\n`,
);
process.stdout.write(`Cross-runtime conformance: ${report.status}; ${String(report.identical)} identical, ${String(report.different)} different.\n`);

if (report.status === 'fail') {
	process.exitCode = 1;
}

async function runTypeScript(): Promise<readonly TypeScriptObservation[]> {
	const harness = path.join(root, 'grammar', 'typescript', 'harness.ts');
	const stdoutOutput = await new Promise<string>((resolve, reject) => {
		const child = spawn(process.execPath, [harness], {
			cwd: root,
			env: {
				...process.env,
				LAB_MANIFEST: manifestPath,
				LAB_FILES: filesDir,
				LAB_STAGE: 'pass',
				LAB_ITERATIONS: '0',
				LAB_WARMUPS: '0',
				LAB_TREE_HASH: '1',
			},
			stdio: ['ignore', 'pipe', 'inherit'],
		});
		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(`TypeScript conformance harness failed with ${String(code)}`));
			}
		});
	});
	const parsed = JSON.parse(stdoutOutput.slice(stdoutOutput.indexOf('{'))) as HarnessOutput;
	return parsed.files.map(({ observation }) => ({
		...observation,
		accepted: observation.lexerDiagnostics === 0 && observation.parseDiagnostics === 0,
	}));
}
