import { describe, expect, it } from 'vitest';
import { buildReport, renderMarkdown } from '../src/report.ts';
import { type CorpusFile, type CorpusManifest, type ParseObservation, type ParsedFileRun, type ParserAdapter } from '../src/types.ts';

const file: CorpusFile = { id: 0, path: 'a.sql', file: 'a.sql', bytes: 12, lines: 1, sha256: 'a' };
const manifest: CorpusManifest = {
	id: 'test',
	description: 'test',
	visibility: 'private',
	root: '/tmp',
	sourceFiles: 1,
	sourceBytes: 12,
	selection: 'all',
	files: [file],
};
const observation = (coreMs: number): ParseObservation => ({
	file: 'a.sql',
	coreMs,
	adapterMs: coreMs + 1,
	phases: {},
	lexerDiagnostics: 0,
	parseDiagnostics: 0,
	tokens: 3,
	hiddenTokens: 0,
	prediction: 'sll',
	sllAttempts: 1,
	llAttempts: 0,
	peakRssBytes: 100,
});
const run: ParsedFileRun = {
	observedAt: '2026-01-01T00:00:00.000Z',
	coldSamples: [observation(10)],
	cold: observation(10),
	warmSamples: [observation(8), observation(9)],
	pass: observation(12),
};
const adapter: ParserAdapter = {
	identity: { name: 'test', language: 'TypeScript', grammar: 'g', runtime: 'r' },
	run: async () => ({ cold: observation(1), warm: observation(1), pass: observation(1) }),
	available: async () => true,
};

describe('report', () => {
	it('aggregates by adapter and stage', () => {
		const report = buildReport({
			experiment: 'test',
			hypothesis: 'it works',
			manifest,
			adapters: [adapter],
			config: { iterations: 2, warmups: 1, coldRepeats: 1, defaultSchema: 'APP' },
			perFile: [{ file, adapters: { test: run } }],
			failures: [],
		});

		expect(report.aggregate.test?.cold.p50).toBe(10);
		expect(report.aggregate.test?.warm.p50).toBe(8.5);
		expect(renderMarkdown(report)).toContain('| test |');
	});
});
