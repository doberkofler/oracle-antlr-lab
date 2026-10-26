import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { largestQuartile, parseSelectionReport, q4FromReport, selectionFingerprint, tailFromReport } from '../src/selection.ts';
import { type CorpusFile, type CorpusManifest } from '../src/types.ts';

const root = path.resolve(import.meta.dirname, '..');

const fileOf = (id: number, bytes: number, sha256 = `digest-${String(id)}`): CorpusFile => ({
	id,
	path: `file-${String(id)}.sql`,
	file: `file-${String(id)}.sql`,
	bytes,
	lines: 1,
	sha256,
});

const manifestOf = (files: readonly CorpusFile[]): CorpusManifest => ({
	id: 'test-corpus',
	description: 'test',
	visibility: 'private',
	root: '.',
	sourceFiles: files.length,
	sourceBytes: files.reduce((total, file) => total + file.bytes, 0),
	selection: 'all',
	files,
});

describe('benchmark selection', () => {
	it('uses the experiment 003 Q4 boundary', () => {
		const files = Array.from({ length: 20 }, (_, index) => fileOf(index, (index + 1) * 10));

		expect(largestQuartile(files).map((file) => file.bytes)).toStrictEqual([160, 170, 180, 190, 200]);
	});

	it('computes an order-independent fingerprint and rejects duplicates', () => {
		const files = [fileOf(0, 10), fileOf(1, 20)];

		expect(selectionFingerprint(files)).toBe(selectionFingerprint([...files].reverse()));
		const first = fileOf(0, 10);
		expect(() => selectionFingerprint([first, first])).toThrow(/duplicate/u);
	});

	it('derives a Q4 selection from an audited corpus report', () => {
		const files = Array.from({ length: 8 }, (_, index) => fileOf(index, (index + 1) * 100, `sha-${String(index)}`));
		const manifest = manifestOf(files);
		const report = parseSelectionReport(JSON.stringify({ experiment: '003', corpus: { id: manifest.id, files } }), 'report');
		const selection = q4FromReport(manifest, 'experiments/003/report.json', 'digest', report);

		expect(selection.mode).toBe('q4');
		expect(selection.files.map((file) => file.id)).toStrictEqual([6, 7]);
		expect(selection.artifact).toMatchObject({ kind: 'report', sha256: 'digest', experiment: '003' });
	});

	it('rejects a Q4 report that does not reproduce the manifest', () => {
		const files = [fileOf(0, 10), fileOf(1, 20)];
		const manifest = manifestOf(files);
		const report = parseSelectionReport(JSON.stringify({ corpus: { id: manifest.id, files: [files[0], { ...files[1], sha256: 'other' }] } }), 'report');

		expect(() => q4FromReport(manifest, 'experiments/003/report.json', 'digest', report)).toThrow(/does not match/u);
	});

	it('selects the highest-cost tail and records the ranking', () => {
		const files = [fileOf(0, 100), fileOf(1, 200), fileOf(2, 300)];
		const manifest = manifestOf(files);
		const report = parseSelectionReport(
			JSON.stringify({
				experiment: '004',
				selection: '12 highest median core',
				files: [
					{ ...files[0], medianCoreMs: 50 },
					{ ...files[1], medianCoreMs: 30 },
					{ ...files[2], medianCoreMs: 90 },
				],
			}),
			'report',
		);
		const selection = tailFromReport({ manifest, artifactPath: 'experiments/004/report.json', artifactDigest: 'digest', report, limit: 2 });

		expect(selection.files.map((file) => file.file)).toStrictEqual(['file-0.sql', 'file-2.sql']);
		expect(selection.ranking).toStrictEqual([
			{ id: 2, file: 'file-2.sql', metric: 'medianCoreMs', value: 90, rank: 1 },
			{ id: 0, file: 'file-0.sql', metric: 'medianCoreMs', value: 50, rank: 2 },
		]);
	});

	it('reproduces the audited Q4 and tail artifacts', () => {
		const q4Report = parseSelectionReport(readFileSync(path.join(root, 'experiments', '003-production-scale', 'report.json'), 'utf8'), '003');
		const q4 = largestQuartile(q4Report.corpusFiles ?? []);

		expect(q4Report.corpusId).toBe('private-production-20261027');
		expect(q4).toHaveLength(311);
		expect(q4[0]?.bytes).toBe(16_990);
		expect(q4.at(-1)?.bytes).toBe(370_020);

		const tailReport = parseSelectionReport(readFileSync(path.join(root, 'experiments', '004-bottleneck-profile', 'report.json'), 'utf8'), '004');
		const ranked = [...(tailReport.ranked ?? [])].sort((left, right) => right.value - left.value || left.file.id - right.file.id);

		expect(ranked).toHaveLength(12);
		expect(ranked[0]?.file.file).toBe('source-001239.pkb');
		expect(ranked[0]?.value).toBeCloseTo(6_017.928_792);
		expect(ranked.at(-1)?.value).toBeLessThan(ranked[0]?.value ?? 0);
	});
});
