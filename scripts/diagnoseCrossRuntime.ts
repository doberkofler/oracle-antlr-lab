import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type LexedTokens, tokenizeSource, tokenName } from '../grammar/typescript/tokenStream.ts';
import { runJavaTokens } from '../src/adapters/java.ts';
import { assertOpaqueIdentities } from '../src/conformance.ts';
import { loadManifest } from '../src/corpus.ts';
import { createProgressReporter } from '../src/progress.ts';

type TokenPosition = Readonly<{ type: number | null; name: string; channel: number | null }>;
type Difference = Readonly<{
	file: string;
	bytes: number;
	sha256: string;
	index: number;
	typeScript: TokenPosition;
	java: TokenPosition;
	typeScriptTokens: number;
	javaTokens: number;
}>;
type TokenClass = Readonly<{
	kind: 'conditional-compilation' | 'other';
	typeScriptToken: string;
	javaToken: string;
	typeScriptChannel: number | null;
	javaChannel: number | null;
	files: number;
}>;
type DiagnosisReport = Readonly<{
	schemaVersion: number;
	experiment: string;
	generatedAt: string;
	javaInput: string;
	corpus: Readonly<{ id: string; visibility: string; files: number; bytes: number }>;
	status: string;
	totals: Readonly<{
		files: number;
		identical: number;
		different: number;
		firstDivergenceInTypes: number;
		firstDivergenceInChannelsOnly: number;
		firstDivergenceAtDirective: number;
	}>;
	classes: readonly TokenClass[];
	differences: readonly Difference[];
}>;

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, '.work', 'private-production', 'manifest.json'));
const experiment = process.argv[3] ?? 'cross-runtime-token-diagnosis';
const javaInput = process.argv[4] ?? 'prepared';

if (javaInput !== 'prepared' && javaInput !== 'raw') {
	throw new Error('Java input mode must be "prepared" or "raw"');
}

const filesDir = path.join(path.dirname(manifestPath), 'files');
const { manifest, files } = loadManifest(manifestPath, filesDir);
assertOpaqueIdentities(manifest.visibility, files);

const progress = createProgressReporter({ label: 'token diagnosis', total: files.length * 2, unit: 'files' });
const javaByFile = new Map(
	(
		await runJavaTokens({ manifestPath, indexes: files.map((file) => file.id), conditional: javaInput === 'prepared' }, (completed) => {
			progress.advance(completed, 'java tokens');
		})
	).map((observation) => [observation.file, observation]),
);
const differences: Difference[] = [];

for (const [index, file] of files.entries()) {
	const java = javaByFile.get(file.file);

	if (java === undefined) {
		throw new Error(`Missing Java token stream for corpus entry ${file.sha256}`);
	}

	const typeScript = tokenizeSource(readFileSync(path.join(filesDir, file.file), 'utf8'));
	const divergence = firstDivergence(typeScript, java);

	if (divergence >= 0) {
		differences.push({
			file: file.path,
			bytes: file.bytes,
			sha256: file.sha256,
			index: divergence,
			typeScript: position(typeScript, divergence),
			java: position(java, divergence),
			typeScriptTokens: typeScript.types.length,
			javaTokens: java.types.length,
		});
	}

	progress.advance(files.length + index + 1, 'typescript tokens');
}

progress.finish(`${String(differences.length)} differing files`);
const classes = summarize(differences);
const directives = differences.filter((difference) => difference.typeScript.name.startsWith('DOLLAR_') || difference.java.name.startsWith('DOLLAR_')).length;
const result: DiagnosisReport = {
	schemaVersion: 1,
	experiment,
	generatedAt: new Date().toISOString(),
	javaInput,
	corpus: { id: manifest.id, visibility: manifest.visibility, files: files.length, bytes: manifest.sourceBytes },
	status: differences.length === 0 ? 'pass' : 'different',
	totals: {
		files: files.length,
		identical: files.length - differences.length,
		different: differences.length,
		firstDivergenceInTypes: differences.filter((difference) => difference.typeScript.type !== difference.java.type).length,
		firstDivergenceInChannelsOnly: differences.filter((difference) => difference.typeScript.type === difference.java.type).length,
		firstDivergenceAtDirective: directives,
	},
	classes,
	differences,
};
const resultsDirectory = path.join(root, 'results', experiment);
mkdirSync(resultsDirectory, { recursive: true });
writeFileSync(path.join(resultsDirectory, 'diagnosis.json'), `${JSON.stringify(result, null, '\t')}\n`);
writeFileSync(path.join(resultsDirectory, 'diagnosis.md'), renderMarkdown(result));
process.stdout.write(
	`Token diagnosis (${javaInput} Java input): ${String(result.totals.identical)} identical, ${String(result.totals.different)} different, ${String(directives)} at a directive.\n`,
);

function firstDivergence(left: LexedTokens, right: LexedTokens): number {
	const limit = Math.max(left.types.length, right.types.length);

	for (let index = 0; index < limit; index += 1) {
		if (left.types[index] !== right.types[index] || left.channels[index] !== right.channels[index]) {
			return index;
		}
	}

	return -1;
}

function position(tokens: LexedTokens, index: number): TokenPosition {
	const type = tokens.types[index];

	if (type === undefined) {
		return { type: null, name: 'END_OF_STREAM', channel: null };
	}

	return { type, name: tokenName(type), channel: tokens.channels[index] ?? null };
}

function summarize(changes: readonly Difference[]): readonly TokenClass[] {
	const grouped = new Map<string, TokenClass>();

	for (const difference of changes) {
		const directive = difference.java.name.startsWith('DOLLAR_')
			? difference.java
			: difference.typeScript.name.startsWith('DOLLAR_')
				? difference.typeScript
				: null;
		const key =
			directive === null
				? [difference.typeScript.name, difference.java.name, difference.typeScript.channel, difference.java.channel].join('\u0000')
				: `directive\u0000${directive.name}`;
		const existing = grouped.get(key);

		grouped.set(key, {
			kind: directive === null ? 'other' : 'conditional-compilation',
			typeScriptToken: directive === null ? difference.typeScript.name : 'any',
			javaToken: directive?.name ?? difference.java.name,
			typeScriptChannel: directive === null ? difference.typeScript.channel : null,
			javaChannel: directive === null ? difference.java.channel : null,
			files: (existing?.files ?? 0) + 1,
		});
	}

	return [...grouped.values()].sort((left, right) => right.files - left.files);
}

function renderMarkdown(report: DiagnosisReport): string {
	const rows =
		report.classes.length === 0
			? '| None | 0 |'
			: report.classes
					.map((tokenClass) => {
						const tokens =
							tokenClass.kind === 'conditional-compilation'
								? `\`${tokenClass.javaToken}\` in Java, hidden in TypeScript`
								: `\`${tokenClass.typeScriptToken}\`/${String(tokenClass.typeScriptChannel ?? 'none')} → \`${tokenClass.javaToken}\`/${String(tokenClass.javaChannel ?? 'none')}`;

						return `| ${tokenClass.kind === 'conditional-compilation' ? 'conditional-compilation' : 'token pair'} | ${tokens} | ${String(tokenClass.files)} |`;
					})
					.join('\n');

	return `# ${report.experiment}

Java input: **${report.javaInput}**. ${String(report.totals.identical)} of ${String(report.totals.files)} files had identical symbolic token streams; ${String(report.totals.different)} differed.

| Class | First divergent token (TypeScript/Java) | Files |
| --- | --- | ---: |
${rows}

${String(report.totals.firstDivergenceAtDirective)} differences occur where one runtime sees a conditional-compilation directive token. Per-file identities and indices are retained in the private \`diagnosis.json\`; no token text or source offsets are recorded.
`;
}
