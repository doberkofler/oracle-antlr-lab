import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type CorpusFile, type CorpusManifest } from './types.ts';

/** Explicit benchmark selection modes. */
export type SelectionMode = 'full' | 'q4' | 'tail';

/** Audited artifact that justifies a selection. */
export type SelectionArtifact = Readonly<{
	kind: 'manifest' | 'report';
	/** Workspace-relative POSIX path; null for an in-memory manifest. */
	path: string | null;
	sha256: string;
	experiment: string | null;
	selection: string | null;
}>;

/** One ranked tail candidate and the cost metric that ordered it. */
export type RankedSelectionFile = Readonly<{
	file: CorpusFile;
	metric: string;
	value: number;
}>;

/** Ranking evidence retained with a tail selection. */
export type SelectionRank = Readonly<{
	id: number;
	file: string;
	metric: string;
	value: number;
	rank: number;
}>;

/** Reproducible file selection and its provenance. */
export type BenchmarkSelection = Readonly<{
	schemaVersion: 1;
	mode: SelectionMode;
	criteria: string;
	corpus: Readonly<{ id: string; sourceFiles: number; sourceBytes: number }>;
	artifact: SelectionArtifact;
	population: Readonly<{ files: number; bytes: number }>;
	selected: Readonly<{ files: number; bytes: number; minBytes: number; maxBytes: number }>;
	/** SHA-256 over ordered file identity and content digest pairs. */
	fingerprint: string;
	files: readonly CorpusFile[];
	ranking: readonly SelectionRank[] | null;
}>;

/** Parsed audited selection artifact. */
export type SelectionReport = Readonly<{
	experiment: string | null;
	selection: string | null;
	corpusId: string | null;
	corpusFiles: readonly CorpusFile[] | null;
	ranked: readonly RankedSelectionFile[] | null;
}>;

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/**
 * Stable selection identity. File order is irrelevant; duplicate identities are
 * rejected before a fingerprint is computed.
 *
 * @param files - Selected corpus files.
 * @returns SHA-256 over sorted identity and content digest pairs.
 */
export const selectionFingerprint = (files: readonly CorpusFile[]): string => {
	const identities = files.map((file) => `${file.file}\u0000${file.sha256}`);
	const unique = new Set(identities);

	if (unique.size !== identities.length) {
		throw new Error('Selection contains duplicate file identities');
	}

	return sha256([...unique].sort().join('\n'));
};

/**
 * Largest byte-size quartile using the experiment 003 boundary rule.
 *
 * @param files - Population files.
 * @returns Deterministically ordered quartile members.
 */
export const largestQuartile = (files: readonly CorpusFile[]): readonly CorpusFile[] => {
	const sorted = [...files].sort((left, right) => left.bytes - right.bytes || left.id - right.id);
	return sorted.slice(Math.floor((3 * sorted.length) / 4), sorted.length);
};

/**
 * Derives the largest byte-size quartile directly from a manifest.
 *
 * @param manifest - Current corpus.
 * @param manifestPath - Manifest path used for provenance.
 * @returns Q4 selection.
 */
export const q4FromManifest = (manifest: CorpusManifest, manifestPath: string, workspaceRoot: string): BenchmarkSelection => {
	const files = largestQuartile(manifest.files);
	return selection({
		mode: 'q4',
		criteria: `Largest byte-size quartile: ${String(files.length)} of ${String(manifest.files.length)} files, matching the experiment 003 strata boundary.`,
		manifest,
		artifact: manifestArtifact(manifestPath, workspaceRoot),
		files,
		ranking: null,
	});
};

/**
 * Derives the largest byte-size quartile from an audited corpus report and
 * verifies that it reproduces the current manifest.
 *
 * @param manifest - Current corpus.
 * @param artifactPath - Report path used for provenance.
 * @param report - Parsed report.
 * @returns Q4 selection.
 */
export const q4FromReport = (manifest: CorpusManifest, artifactPath: string, artifactDigest: string, report: SelectionReport): BenchmarkSelection => {
	if (report.corpusFiles === null) {
		throw new Error('Q4 selection source does not contain corpus.files');
	}

	if (report.corpusId !== null && report.corpusId !== manifest.id) {
		throw new Error(`Q4 selection source corpus ${report.corpusId} does not match ${manifest.id}`);
	}

	assertSamePopulation(manifest.files, report.corpusFiles);
	const files = largestQuartile(report.corpusFiles);
	const current = largestQuartile(manifest.files);

	if (selectionFingerprint(files) !== selectionFingerprint(current)) {
		throw new Error('Q4 selection source does not reproduce the current manifest');
	}

	return selection({
		mode: 'q4',
		criteria: `Largest byte-size quartile: ${String(files.length)} of ${String(manifest.files.length)} files, reproduced from ${artifactPath}.`,
		manifest,
		artifact: reportArtifact(artifactPath, artifactDigest, report),
		files: current,
		ranking: null,
	});
};

/**
 * Selects the highest-cost files from an audited ranking report.
 *
 * @param input - Current corpus, report path, parsed report, and tail size.
 * @returns Tail selection.
 */
export const tailFromReport = (
	input: Readonly<{
		manifest: CorpusManifest;
		artifactPath: string;
		artifactDigest: string;
		report: SelectionReport;
		limit: number;
	}>,
): BenchmarkSelection => {
	const ranked = input.report.ranked;

	if (ranked === null || ranked.length === 0) {
		throw new Error('Tail selection source does not contain ranked files');
	}

	if (input.limit < 1 || input.limit > ranked.length) {
		throw new Error(`Tail size must be between 1 and ${String(ranked.length)}; source supplies ${String(ranked.length)} ranked files`);
	}

	const ordered = [...ranked].sort((left, right) => right.value - left.value || left.file.id - right.file.id);
	const byIdentity = new Map(input.manifest.files.map((file) => [file.file, file]));
	const selected = ordered.slice(0, input.limit).map((entry) => {
		const manifestFile = byIdentity.get(entry.file.file);

		if (manifestFile === undefined) {
			throw new Error(`Tail selection source references ${entry.file.file} outside the current manifest`);
		}

		if (manifestFile.sha256 !== entry.file.sha256) {
			throw new Error(`Tail selection source digest does not match ${entry.file.file}`);
		}

		return manifestFile;
	});

	return selection({
		mode: 'tail',
		criteria: `${String(input.limit)} highest ${ordered[0]?.metric ?? 'cost'} files from ${input.artifactPath}; tail-biased by design.`,
		manifest: input.manifest,
		artifact: reportArtifact(input.artifactPath, input.artifactDigest, input.report),
		files: [...selected].sort((left, right) => left.id - right.id),
		ranking: ordered.slice(0, input.limit).map((entry, index) => ({
			id: entry.file.id,
			file: entry.file.file,
			metric: entry.metric,
			value: entry.value,
			rank: index + 1,
		})),
	});
};

/**
 * Selects every file in the manifest.
 *
 * @param manifest - Current corpus.
 * @param manifestPath - Manifest path used for provenance.
 * @returns Full selection.
 */
export const fullSelection = (manifest: CorpusManifest, manifestPath: string, workspaceRoot: string): BenchmarkSelection =>
	selection({
		mode: 'full',
		criteria: `All ${String(manifest.files.length)} files in ${manifest.id}.`,
		manifest,
		artifact: manifestArtifact(manifestPath, workspaceRoot),
		files: manifest.files,
		ranking: null,
	});

/**
 * Resolves a workspace-relative path without leaking an external absolute path.
 *
 * @param file - Candidate path.
 * @param workspaceRoot - Repository root.
 * @returns POSIX path relative to the workspace root.
 */
export const workspaceRelative = (file: string, workspaceRoot: string): string => {
	const relative = path.relative(workspaceRoot, path.resolve(file));

	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Selection source must be inside the workspace: ${file}`);
	}

	return relative.split(path.sep).join('/');
};

/**
 * Reads and parses an audited selection artifact.
 *
 * @param file - Manifest or report path.
 * @param workspaceRoot - Repository root.
 * @returns Workspace-relative path, digest, and parsed contents.
 */
export const readSelectionArtifact = (file: string, workspaceRoot: string): Readonly<{ artifactPath: string; digest: string; report: SelectionReport }> => {
	const artifactPath = workspaceRelative(file, workspaceRoot);
	const contents = readFileSync(path.resolve(workspaceRoot, artifactPath));
	const report = parseSelectionReport(contents.toString('utf8'), artifactPath);
	return { artifactPath, digest: sha256(contents), report };
};

/**
 * Parses the evidence shapes used by the audited experiment reports.
 *
 * @param text - JSON document.
 * @param label - Artifact label for error messages.
 * @returns Normalized selection evidence.
 */
export const parseSelectionReport = (text: string, label: string): SelectionReport => {
	const document = objectOf(JSON.parse(text), label);
	const corpus = document['corpus'] === undefined ? null : objectOf(document['corpus'], `${label}.corpus`);
	const corpusFiles =
		corpus === null || corpus['files'] === undefined || !Array.isArray(corpus['files'])
			? null
			: corpus['files'].map((entry, index) => parseFile(entry, `${label}.corpus.files[${String(index)}]`));
	const files = document['files'] === undefined || !Array.isArray(document['files']) ? null : document['files'];
	const ranked =
		files === null
			? null
			: files.flatMap((entry, index) => {
					const record = objectOf(entry, `${label}.files[${String(index)}]`);
					const value = record['medianCoreMs'];

					if (typeof value !== 'number' || !Number.isFinite(value)) {
						return [];
					}

					return [{ file: parseFile(record, `${label}.files[${String(index)}]`), metric: 'medianCoreMs', value }];
				});

	return {
		experiment: stringOrNull(document['experiment']),
		selection: stringOrNull(document['selection']),
		corpusId: corpus === null ? null : stringOrNull(corpus['id']),
		corpusFiles,
		ranked: ranked === null || ranked.length === 0 ? null : ranked,
	};
};

const selection = (
	input: Readonly<{
		mode: SelectionMode;
		criteria: string;
		manifest: CorpusManifest;
		artifact: SelectionArtifact;
		files: readonly CorpusFile[];
		ranking: readonly SelectionRank[] | null;
	}>,
): BenchmarkSelection => {
	if (input.files.length === 0) {
		throw new Error('Selection produced no files');
	}

	const bytes = input.files.map((file) => file.bytes);

	return {
		schemaVersion: 1,
		mode: input.mode,
		criteria: input.criteria,
		corpus: { id: input.manifest.id, sourceFiles: input.manifest.sourceFiles, sourceBytes: input.manifest.sourceBytes },
		artifact: input.artifact,
		population: {
			files: input.manifest.files.length,
			bytes: input.manifest.files.reduce((total, file) => total + file.bytes, 0),
		},
		selected: {
			files: input.files.length,
			bytes: bytes.reduce((total, value) => total + value, 0),
			minBytes: Math.min(...bytes),
			maxBytes: Math.max(...bytes),
		},
		fingerprint: selectionFingerprint(input.files),
		files: input.files,
		ranking: input.ranking,
	};
};

const manifestArtifact = (manifestPath: string, workspaceRoot: string): SelectionArtifact => ({
	kind: 'manifest',
	path: workspaceRelative(manifestPath, workspaceRoot),
	sha256: sha256(readFileSync(path.resolve(manifestPath))),
	experiment: null,
	selection: null,
});

const reportArtifact = (artifactPath: string, artifactDigest: string, report: SelectionReport): SelectionArtifact => ({
	kind: 'report',
	path: artifactPath,
	sha256: artifactDigest,
	experiment: report.experiment,
	selection: report.selection,
});

const assertSamePopulation = (manifestFiles: readonly CorpusFile[], sourceFiles: readonly CorpusFile[]): void => {
	if (manifestFiles.length !== sourceFiles.length) {
		throw new Error(`Selection source has ${String(sourceFiles.length)} files; manifest has ${String(manifestFiles.length)}`);
	}

	const manifest = new Map(manifestFiles.map((file) => [file.file, file.sha256]));

	for (const file of sourceFiles) {
		if (manifest.get(file.file) !== file.sha256) {
			throw new Error(`Selection source does not match manifest file ${file.file}`);
		}
	}
};

const objectOf = (value: unknown, label: string): Record<string, unknown> => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}

	return value as Record<string, unknown>;
};

const parseFile = (value: unknown, label: string): CorpusFile => {
	const record = objectOf(value, label);

	return {
		id: numberField(record, 'id', label),
		path: stringField(record, 'path', label),
		file: stringField(record, 'file', label),
		bytes: numberField(record, 'bytes', label),
		lines: numberField(record, 'lines', label),
		sha256: stringField(record, 'sha256', label),
	};
};

const numberField = (record: Readonly<Record<string, unknown>>, field: string, label: string): number => {
	const value = record[field];

	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${label}.${field} must be a finite number`);
	}

	return value;
};

const stringField = (record: Readonly<Record<string, unknown>>, field: string, label: string): string => {
	const value = record[field];

	if (typeof value !== 'string' || value === '') {
		throw new Error(`${label}.${field} must be a non-empty string`);
	}

	return value;
};

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
