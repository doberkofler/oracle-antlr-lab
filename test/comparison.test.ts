import { describe, expect, it } from 'vitest';
import { benchmarkPolicy } from '../src/benchmarkPolicy.ts';
import { compareReports, type ProductionPassRun, type ProductionReport } from '../src/comparison.ts';
import { type CorpusFile, type ParseObservation } from '../src/types.ts';

const files: readonly CorpusFile[] = [
	{ id: 0, path: 'a.sql', file: 'a.sql', bytes: 10, lines: 1, sha256: 'a' },
	{ id: 1, path: 'b.sql', file: 'b.sql', bytes: 20, lines: 1, sha256: 'b' },
];
const firstFile = files[0];
const secondFile = files[1];

if (firstFile === undefined || secondFile === undefined) {
	throw new Error('Test fixture requires two files');
}

const observation = (file: string, coreMs: number, llAttempts: number, diagnostics = 0): ParseObservation => ({
	file,
	coreMs,
	adapterMs: coreMs + 1,
	phases: { setupMs: 1, lexerMs: 2, sllParseMs: coreMs - 3, llParseMs: llAttempts > 0 ? 3 : 0 },
	lexerDiagnostics: 0,
	parseDiagnostics: diagnostics,
	tokens: 3,
	hiddenTokens: 0,
	prediction: llAttempts > 0 ? 'sll-fallback-ll' : 'sll',
	sllAttempts: 1,
	llAttempts,
	peakRssBytes: 100,
});

const pass = (repeat: number, entries: readonly ParseObservation[]): ProductionPassRun => ({
	repeat,
	wallMs: 100,
	coreMs: entries.reduce((total, entry) => total + entry.coreMs, 0),
	adapterMs: entries.reduce((total, entry) => total + entry.adapterMs, 0),
	setupMs: entries.length,
	lexerMs: entries.length * 2,
	sllParseMs: entries.reduce((total, entry) => total + (entry.phases['sllParseMs'] ?? 0), 0),
	llParseMs: entries.reduce((total, entry) => total + (entry.phases['llParseMs'] ?? 0), 0),
	peakRssBytes: 100,
	lexerDiagnostics: 0,
	parseDiagnostics: entries.reduce((total, entry) => total + entry.parseDiagnostics, 0),
	llFallbackFiles: entries.filter((entry) => entry.llAttempts > 0).length,
	files: entries,
});

const reportOf = (name: string, runs: readonly ProductionPassRun[], policy: ProductionReport['policy'] = null): ProductionReport => ({
	experiment: name,
	generatedAt: '2026-01-01T00:00:00.000Z',
	environment: null,
	corpus: { id: 'test', sourceFiles: files.length, sourceBytes: 30, selection: 'all', files },
	selection: null,
	policy,
	adapters: [],
	runs: { typescript: runs },
});

describe('report comparison', () => {
	it('compares repeated control and candidate passes with paired deltas', () => {
		const control = reportOf('control', [
			pass(1, [observation('a.sql', 10, 1, 1), observation('b.sql', 20, 0)]),
			pass(2, [observation('a.sql', 12, 1, 1), observation('b.sql', 24, 0)]),
		]);
		const candidate = reportOf('candidate', [
			pass(1, [observation('a.sql', 8, 0, 1), observation('b.sql', 18, 0)]),
			pass(2, [observation('a.sql', 10, 0, 1), observation('b.sql', 20, 0)]),
		]);
		const comparison = compareReports({ experiment: 'test', controlArtifact: 'control', candidateArtifact: 'candidate', control, candidate });
		const typescript = comparison.adapters['typescript'];

		expect(typescript?.paired?.coreMs.mean).toBe(-2.5);
		expect(typescript?.fallback).toStrictEqual({ controlFiles: 1, candidateFiles: 0, stopped: 1, introduced: 0, both: 0, neither: 1 });
		expect(typescript?.perFile?.find((entry) => entry.file === 'a.sql')?.llDeltaMs).toBe(-3);
		expect(typescript?.changePercent.coreMs).toBeLessThan(0);
	});

	it('rejects reports from different selections', () => {
		const control = reportOf('control', [pass(1, [observation('a.sql', 10, 0), observation('b.sql', 20, 0)])]);
		const candidate = reportOf('candidate', [pass(1, [observation('a.sql', 10, 0), observation('b.sql', 20, 0)])]);
		const changed: ProductionReport = {
			...candidate,
			corpus: { ...candidate.corpus, files: [{ ...firstFile, sha256: 'changed' }, secondFile] },
		};

		expect(() => compareReports({ experiment: 'test', controlArtifact: 'control', candidateArtifact: 'candidate', control, candidate: changed })).toThrow(
			/fingerprint differs/u,
		);
	});

	it('rejects campaigns with different heap or cache identities', () => {
		const runs = [pass(1, [observation('a.sql', 10, 0), observation('b.sql', 20, 0)])];
		const defaultHeap = benchmarkPolicy(undefined, 4_192 * 1024 * 1024);
		const benchmarkHeap = benchmarkPolicy('--max-old-space-size=8192', 8_288 * 1024 * 1024);
		const bounded = benchmarkPolicy(undefined, 4_192 * 1024 * 1024, {
			LAB_DFA_SELECTIVE_EVERY: '10',
			LAB_DFA_HOT_MAX_STATES: '90000',
			LAB_DFA_COLD_MAX_STATES: '2000',
		});

		expect(() =>
			compareReports({
				experiment: 'test',
				controlArtifact: 'control',
				candidateArtifact: 'candidate',
				control: reportOf('control', runs, defaultHeap),
				candidate: reportOf('candidate', runs, benchmarkHeap),
			}),
		).toThrow(/heap limit differs/u);
		expect(() =>
			compareReports({
				experiment: 'test',
				controlArtifact: 'control',
				candidateArtifact: 'candidate',
				control: reportOf('control', runs, defaultHeap),
				candidate: reportOf('candidate', runs, bounded),
			}),
		).toThrow(/DFA cache policy differs/u);
	});

	it('records an explicitly overridden policy mismatch', () => {
		const runs = [pass(1, [observation('a.sql', 10, 0), observation('b.sql', 20, 0)])];
		const comparison = compareReports({
			experiment: 'test',
			controlArtifact: 'control',
			candidateArtifact: 'candidate',
			control: reportOf('control', runs, benchmarkPolicy(undefined, 4_192 * 1024 * 1024)),
			candidate: reportOf('candidate', runs, benchmarkPolicy('--max-old-space-size=8192', 8_288 * 1024 * 1024)),
			allowPolicyMismatch: true,
		});

		expect(comparison.policy.matches).toBe(false);
		expect(comparison.policy.overridden).toBe(true);
		expect(comparison.policy.differences.length).toBeGreaterThan(0);
	});

	it('records a matching policy and leaves a missing identity unknown', () => {
		const runs = [pass(1, [observation('a.sql', 10, 0), observation('b.sql', 20, 0)])];
		const policy = benchmarkPolicy('--max-old-space-size=8192', 8_288 * 1024 * 1024);
		const matched = compareReports({
			experiment: 'test',
			controlArtifact: 'control',
			candidateArtifact: 'candidate',
			control: reportOf('control', runs, policy),
			candidate: reportOf('candidate', runs, policy),
		});
		const unknown = compareReports({
			experiment: 'test',
			controlArtifact: 'control',
			candidateArtifact: 'candidate',
			control: reportOf('control', runs),
			candidate: reportOf('candidate', runs),
		});

		expect(matched.policy.matches).toBe(true);
		expect(matched.policy.overridden).toBe(false);
		expect(unknown.policy.matches).toBeNull();
	});
});
