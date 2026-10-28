import { describe, expect, it } from 'vitest';

import {
	assessHeapSafety,
	benchmarkPolicy,
	comparePolicy,
	dfaCacheIdentity,
	describePolicy,
	FULL_CORPUS_PERSISTENT_HEAP_MIB,
	heapIdentity,
	parseMaxOldSpaceSizeMiB,
	parseReportPolicy,
	policyFingerprint,
} from '../src/benchmarkPolicy.ts';

const MIB = 1024 * 1024;
const DEFAULT_LIMIT = 4_192 * MIB;
const BENCHMARK_LIMIT = 8_288 * MIB;

const selectiveEnvironment = {
	LAB_DFA_SELECTIVE_EVERY: '10',
	LAB_DFA_HOT_DECISIONS: '2993,2251,2990,2595',
	LAB_DFA_HOT_MAX_STATES: '90000',
	LAB_DFA_COLD_MAX_STATES: '2000',
};

describe('heap identity', () => {
	it('reads the last max-old-space-size option', () => {
		expect(parseMaxOldSpaceSizeMiB('--enable-source-maps --max-old-space-size=8192')).toBe(8192);
		expect(parseMaxOldSpaceSizeMiB('--max_old_space_size 6144 --max-old-space-size 8192')).toBe(8192);
		expect(parseMaxOldSpaceSizeMiB('--enable-source-maps')).toBeNull();
		expect(parseMaxOldSpaceSizeMiB(undefined)).toBeNull();
	});

	it('distinguishes a configured limit from the runtime default', () => {
		const configured = heapIdentity('--max-old-space-size=8192', BENCHMARK_LIMIT);
		const fallback = heapIdentity(undefined, DEFAULT_LIMIT);

		expect(configured.origin).toBe('max-old-space-size');
		expect(configured.maxOldSpaceSizeMiB).toBe(8192);
		expect(configured.limitMiB).toBe(8288);
		expect(fallback.origin).toBe('v8-default');
		expect(fallback.maxOldSpaceSizeMiB).toBeNull();
	});

	it('rejects a non-positive effective limit', () => {
		expect(() => heapIdentity(undefined, 0)).toThrow(/positive/u);
	});
});

describe('DFA cache identity', () => {
	it('records the persistent default', () => {
		expect(dfaCacheIdentity({})).toStrictEqual({
			mode: 'persistent',
			clearEveryFiles: null,
			clearAtHeapMiB: null,
			selective: null,
		});
	});

	it('records periodic clearing', () => {
		const identity = dfaCacheIdentity({ LAB_DFA_CLEAR_EVERY: '50', LAB_DFA_MAX_HEAP_MIB: '2048' });

		expect(identity.mode).toBe('periodic-clear');
		expect(identity.clearEveryFiles).toBe(50);
		expect(identity.clearAtHeapMiB).toBe(2048);
	});

	it('records selective eviction with sorted hot decisions', () => {
		const identity = dfaCacheIdentity(selectiveEnvironment);

		expect(identity.mode).toBe('selective-eviction');
		expect(identity.selective).toStrictEqual({
			everyFiles: 10,
			atHeapMiB: null,
			hotDecisions: [2251, 2595, 2990, 2993],
			hotMaxStates: 90_000,
			coldMaxStates: 2_000,
			totalMaxStates: null,
		});
	});

	it('stays persistent when bounds have no trigger or triggers have no bounds', () => {
		expect(dfaCacheIdentity({ LAB_DFA_HOT_MAX_STATES: '90000' }).mode).toBe('persistent');
		expect(dfaCacheIdentity({ LAB_DFA_SELECTIVE_EVERY: '10' }).mode).toBe('persistent');
	});

	it('rejects invalid values before a campaign starts', () => {
		expect(() => dfaCacheIdentity({ LAB_DFA_CLEAR_EVERY: 'soon' })).toThrow(/LAB_DFA_CLEAR_EVERY/u);
		expect(() => dfaCacheIdentity({ ...selectiveEnvironment, LAB_DFA_HOT_DECISIONS: 'x' })).toThrow(/LAB_DFA_HOT_DECISIONS/u);
	});
});

describe('benchmark policy', () => {
	it('fingerprints the effective heap and cache dimensions', () => {
		const first = benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT);
		const repeat = benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT);
		const smaller = benchmarkPolicy(undefined, DEFAULT_LIMIT);

		expect(first.fingerprint).toBe(repeat.fingerprint);
		expect(first.fingerprint).not.toBe(smaller.fingerprint);
		expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(policyFingerprint(first)).toBe(first.fingerprint);
	});

	it('ignores NODE_OPTIONS text that does not change the effective identity', () => {
		const first = benchmarkPolicy('--enable-source-maps --max-old-space-size=8192', BENCHMARK_LIMIT);
		const second = benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT);

		expect(first.fingerprint).toBe(second.fingerprint);
	});
});

describe('heap safety preflight', () => {
	it('rejects the persistent cache on a production-scale full selection', () => {
		const findings = assessHeapSafety({
			policy: benchmarkPolicy(undefined, DEFAULT_LIMIT),
			mode: 'full',
			files: 1_244,
			bytes: 20_944_414,
		});

		expect(findings).toHaveLength(1);
		expect(findings[0]?.level).toBe('error');
		expect(findings[0]?.message).toContain('NODE_OPTIONS=--max-old-space-size=8192');
		expect(findings[0]?.message).toContain('--allow-unsafe-heap');
		expect(findings[0]?.message).toContain(String(FULL_CORPUS_PERSISTENT_HEAP_MIB));
	});

	it('accepts the benchmark heap, a bounded cache, and small selections', () => {
		const benchmarkHeap = benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT);
		const bounded = benchmarkPolicy(undefined, DEFAULT_LIMIT, selectiveEnvironment);

		expect(assessHeapSafety({ policy: benchmarkHeap, mode: 'full', files: 1_244, bytes: 20_944_414 })[0]?.level).toBe('ok');
		expect(assessHeapSafety({ policy: bounded, mode: 'full', files: 1_244, bytes: 20_944_414 })[0]?.level).toBe('ok');
		expect(assessHeapSafety({ policy: benchmarkPolicy(undefined, DEFAULT_LIMIT), mode: 'full', files: 51, bytes: 54_424 })[0]?.level).toBe('ok');
	});

	it('warns for a persistent Q4 campaign under the default heap', () => {
		const findings = assessHeapSafety({ policy: benchmarkPolicy(undefined, DEFAULT_LIMIT), mode: 'q4', files: 311, bytes: 15_000_000 });

		expect(findings[0]?.level).toBe('warning');
		expect(findings[0]?.message).toContain('Q4');
	});
});

describe('report policy parsing', () => {
	it('round-trips a recorded policy', () => {
		const policy = benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT, selectiveEnvironment);
		const parsed = parseReportPolicy({ typeScriptPolicy: policy });

		expect(parsed?.heap?.limitMiB).toBe(8288);
		expect(parsed?.dfa.mode).toBe('selective-eviction');
		expect(parsed === null ? '' : describePolicy(parsed)).toContain('8288 MiB heap');
	});

	it('reads the legacy cache fields but cannot recover the heap', () => {
		const parsed = parseReportPolicy({ typeScriptDfaClearEveryFiles: 'never', typeScriptDfaMaxHeapMiB: 'never' });

		expect(parsed).not.toBeNull();
		expect(parsed?.heap).toBeNull();
		expect(parsed?.dfa.mode).toBe('persistent');
	});

	it('returns null when no policy is recorded and rejects malformed records', () => {
		expect(parseReportPolicy(undefined)).toBeNull();
		expect(parseReportPolicy({ repeats: 3 })).toBeNull();
		expect(() => parseReportPolicy({ typeScriptPolicy: { heap: {}, dfa: {} } })).toThrow(/malformed/u);
	});
});

describe('policy comparison', () => {
	const benchmarkHeap = benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT);
	const defaultHeap = benchmarkPolicy(undefined, DEFAULT_LIMIT);

	it('matches identical identities', () => {
		const result = comparePolicy(benchmarkHeap, benchmarkHeap);

		expect(result.matches).toBe(true);
		expect(result.differences).toStrictEqual([]);
	});

	it('reports heap and cache differences', () => {
		const heapDiff = comparePolicy(benchmarkHeap, defaultHeap);
		const cacheDiff = comparePolicy(benchmarkHeap, benchmarkPolicy('--max-old-space-size=8192', BENCHMARK_LIMIT, selectiveEnvironment));

		expect(heapDiff.matches).toBe(false);
		expect(heapDiff.differences[0]).toContain('heap limit differs');
		expect(cacheDiff.matches).toBe(false);
		expect(cacheDiff.differences[0]).toContain('DFA cache policy differs');
	});

	it('returns unknown when a heap identity is absent', () => {
		const legacy = parseReportPolicy({ typeScriptDfaClearEveryFiles: 'never', typeScriptDfaMaxHeapMiB: 'never' });

		expect(comparePolicy(legacy, benchmarkHeap).matches).toBeNull();
		expect(comparePolicy(null, benchmarkHeap).matches).toBeNull();
	});
});
