import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, loadManifest, quantileSample } from '../src/corpus.ts';
import { type CorpusFile } from '../src/types.ts';

const fileOf = (id: number, bytes: number): CorpusFile => ({
	id,
	path: `file-${String(id)}.sql`,
	file: `file-${String(id)}.sql`,
	bytes,
	lines: 1,
	sha256: '',
});

describe('corpus selection', () => {
	it('selects unique files by size quantile', () => {
		const files = Array.from({ length: 20 }, (_, index) => fileOf(index, (index + 1) * 10));
		const selected = quantileSample(files, 5);

		expect(selected).toHaveLength(5);
		expect(new Set(selected.map((file) => file.file)).size).toBe(5);
		expect(selected.map((file) => file.bytes)).toStrictEqual([10, 60, 110, 150, 200]);
	});

	it('builds and verifies a manifest', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'oracle-antlr-lab-'));

		try {
			const source = path.join(root, 'source');
			mkdirSync(source);
			writeFileSync(path.join(source, 'a.sql'), 'select 1 from dual;\n');
			writeFileSync(path.join(source, 'b.pkb'), 'create package body b as end b;\n/\n');

			const manifest = buildManifest({
				id: 'test',
				description: 'test corpus',
				sourceRoot: source,
				outputRoot: path.join(root, 'out'),
				visibility: 'private',
				limit: 2,
			});

			expect(manifest.files).toHaveLength(2);
			expect(manifest.files.every((file) => /^source-\d{6}\.(?:pkb|sql)$/u.test(file.path))).toBe(true);
			expect(JSON.stringify(manifest)).not.toContain('a.sql');
			expect(loadManifest(path.join(root, 'out', 'manifest.json'), path.join(root, 'out', 'files')).files).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('rejects a digest mismatch', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'oracle-antlr-lab-'));

		try {
			const source = path.join(root, 'source');
			mkdirSync(source);
			writeFileSync(path.join(source, 'a.sql'), 'select 1 from dual;\n');
			buildManifest({ id: 'test', description: 'test', sourceRoot: source, outputRoot: path.join(root, 'out'), visibility: 'private' });
			const [file] = manifestFiles(path.join(root, 'out', 'manifest.json'));
			writeFileSync(path.join(root, 'out', 'files', file ?? ''), 'changed\n');

			expect(() => loadManifest(path.join(root, 'out', 'manifest.json'), path.join(root, 'out', 'files'))).toThrow(/Digest mismatch/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

const manifestFiles = (manifestPath: string): readonly string[] => {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Readonly<{ files: readonly Readonly<{ file: string }>[] }>;
	return manifest.files.map((file) => file.file);
};
