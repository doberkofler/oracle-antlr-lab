import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type CorpusFile, type CorpusManifest } from './types.ts';

export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.sql', '.pks', '.pkg', '.pkb', '.prc', '.fnc', '.trg', '.typ', '.tyb', '.pls']);

const relativePosix = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');

/**
 * Reads a manifest and verifies every selected file digest.
 *
 * @param manifestPath - Absolute manifest path.
 * @param filesDir - Absolute source directory.
 * @param sampleLimit - Optional deterministic size-quantile sample.
 * @returns Validated manifest and selected files.
 * @throws Error on duplicates, missing files, or digest mismatch.
 */
export const loadManifest = (
	manifestPath: string,
	filesDir: string,
	sampleLimit?: number,
): Readonly<{ manifest: CorpusManifest; files: readonly CorpusFile[] }> => {
	const manifest = parseManifest(manifestPath);
	const seen = new Set<string>();

	for (const file of manifest.files) {
		if (seen.has(file.file)) {
			throw new Error(`Duplicate corpus file: ${file.file}`);
		}

		seen.add(file.file);

		const digest = createHash('sha256')
			.update(readFileSync(path.join(filesDir, file.file)))
			.digest('hex');

		if (digest !== file.sha256) {
			throw new Error(`Digest mismatch for ${file.file}: manifest ${file.sha256}, content ${digest}`);
		}
	}

	return { manifest, files: sampleLimit === undefined ? manifest.files : quantileSample(manifest.files, sampleLimit) };
};

const parseManifest = (manifestPath: string): CorpusManifest => {
	const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));

	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('Manifest must be a JSON object');
	}

	const candidate = parsed as Partial<CorpusManifest>;

	if (typeof candidate.id !== 'string' || typeof candidate.description !== 'string' || !Array.isArray(candidate.files)) {
		throw new Error('Manifest requires id, description, and files');
	}

	return candidate as CorpusManifest;
};

/**
 * Selects a deterministic byte-size quantile sample.
 *
 * @param files - Corpus files.
 * @param limit - Sample size.
 * @returns Selected files, unique and sorted by manifest id.
 */
export const quantileSample = (files: readonly CorpusFile[], limit: number): readonly CorpusFile[] => {
	if (limit >= files.length) {
		return files;
	}

	if (limit < 1) {
		throw new Error('Sample limit must be at least 1');
	}

	const sorted = [...files].sort((left, right) => left.bytes - right.bytes || left.path.localeCompare(right.path));
	const selected = new Map<string, CorpusFile>();

	for (let index = 0; index < limit; index += 1) {
		const position = Math.round((limit === 1 ? 1 : index / (limit - 1)) * (sorted.length - 1));
		const file = sorted[position];

		if (file !== undefined) {
			selected.set(file.file, file);
		}
	}

	if (selected.size !== limit) {
		throw new Error(`Quantile sampling produced ${String(selected.size)} files for a limit of ${String(limit)}`);
	}

	return [...selected.values()].sort((left, right) => left.id - right.id);
};

/**
 * Builds a manifest over a source tree.
 *
 * @param input - Source identity, source root, output root, and sample limit.
 * @returns Written manifest.
 */
export const buildManifest = (
	input: Readonly<{
		id: string;
		description: string;
		sourceRoot: string;
		outputRoot: string;
		visibility: 'public' | 'private';
		limit?: number;
		extensions?: ReadonlySet<string>;
	}>,
): CorpusManifest => {
	const extensions = input.extensions ?? SOURCE_EXTENSIONS;
	const files = readdirSync(input.sourceRoot, { recursive: true })
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => path.join(input.sourceRoot, entry))
		.filter((file) => statSync(file).isFile() && extensions.has(path.extname(file).toLowerCase()))
		.map((file) => ({ absolute: file, bytes: statSync(file).size }))
		.sort((left, right) => left.bytes - right.bytes || left.absolute.localeCompare(right.absolute));

	if (files.length === 0) {
		throw new Error(`No Oracle source files under ${input.sourceRoot}`);
	}

	const candidates: CorpusFile[] = files.map((file, index) => {
		const relative = relativePosix(input.sourceRoot, file.absolute);
		const content = readFileSync(file.absolute);

		return {
			id: index,
			path: relative,
			file: relative,
			bytes: file.bytes,
			lines: content.toString('utf8').split(/\r?\n/u).length,
			sha256: createHash('sha256').update(content).digest('hex'),
		};
	});
	const selected = quantileSample(candidates, input.limit ?? candidates.length);
	const filesRoot = path.join(input.outputRoot, 'files');

	for (const file of selected) {
		const target = path.join(filesRoot, file.file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, readFileSync(path.join(input.sourceRoot, file.file)));
	}

	const manifest: CorpusManifest = {
		id: input.id,
		description: input.description,
		visibility: input.visibility,
		root: input.visibility === 'public' ? '.' : path.resolve(input.outputRoot),
		sourceFiles: files.length,
		sourceBytes: files.reduce((total, file) => total + file.bytes, 0),
		selection: `Size quantiles over ${String(files.length)} files; ${String(selected.length)} selected`,
		files: selected.map((file, index) => ({ ...file, id: index })),
	};

	mkdirSync(input.outputRoot, { recursive: true });
	writeFileSync(path.join(input.outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	return manifest;
};
