import { describe, expect, it } from 'vitest';
import {
	aggregateMemoryPasses,
	assertPublishable,
	categorizeJavaClass,
	type MemoryPass,
	type MemoryReport,
	parseJavaClassHistogram,
	profilerOverhead,
	renderMemoryMarkdown,
	summarizeAllocationProfile,
	summarizeJavaHistogram,
} from '../src/memory.ts';
import type { TimingPass } from '../src/memory.ts';

const pass = (overrides: Readonly<{ dfaRetainedBytes: number; treeBytes: number; tokenBytes: number }>): MemoryPass => ({
	adapter: 'java',
	selection: 'tail',
	repetition: 1,
	files: 12,
	coreMs: 1_000,
	elapsedMs: 1_100,
	startupHeapBytes: 1_000,
	retainedEndBytes: 10_000,
	afterCacheClearBytes: 4_000,
	afterParserDropBytes: 3_000,
	peakRssBytes: 20_000,
	peakHeapUsedBytes: 15_000,
	dfa: { decisions: 10, states: 100, retainedBytes: overrides.dfaRetainedBytes },
	retention: {
		file: 'source-000001.pkb',
		tokens: 10,
		withTreeBytes: 5_000,
		withoutTreeBytes: 4_000,
		withoutSourceBytes: 3_900,
		withoutStreamBytes: 3_800,
		treeBytes: overrides.treeBytes,
		sourceBytes: 100,
		tokenBytes: overrides.tokenBytes,
	},
	representativeHeap: null,
	allocation: { source: 'jvm-thread-allocation', bytes: 50_000, samplingIntervalBytes: null, top: [] },
	heap: {
		source: 'jvm-class-histogram',
		totalBytes: 10_000,
		objects: 100,
		categories: [
			{ category: 'atn-dfa', bytes: 6_000, objects: 60 },
			{ category: 'containers', bytes: 4_000, objects: 40 },
		],
		topOwners: [],
	},
	checkpoints: [],
	evidence: [],
});

describe('memory attribution', () => {
	it('maps JVM classes to parser categories', () => {
		expect(categorizeJavaClass('org.antlr.v4.runtime.atn.ATNConfigSet')).toBe('atn-dfa');
		expect(categorizeJavaClass('[Lorg.antlr.v4.runtime.dfa.DFAState;')).toBe('atn-dfa');
		expect(categorizeJavaClass('[Lorg.antlr.v4.runtime.atn.ATNConfig;')).toBe('atn-dfa');
		expect(categorizeJavaClass('PlSqlParser$Select_statementContext')).toBe('parse-tree');
		expect(categorizeJavaClass('org.antlr.v4.runtime.CommonToken')).toBe('tokens');
		expect(categorizeJavaClass('[B')).toBe('containers');
		expect(categorizeJavaClass('[Ljdk.internal.vm.FillerElement;')).toBe('runtime');
		expect(categorizeJavaClass('java.lang.String')).toBe('strings');
	});

	it('parses class histograms with module suffixes and array classes', () => {
		const entries = parseJavaClassHistogram(
			[
				' num     #instances         #bytes  class name (module)',
				'-------------------------------------------------------',
				'   1:            10            100  org.antlr.v4.runtime.atn.ATNConfig (java.base@21.0.5)',
				'   2:            20            400  [B (java.base@21.0.5)',
				'Total:            30            500',
			].join('\n'),
		);

		expect(entries).toStrictEqual([
			{ className: '[B', instances: 20, bytes: 400 },
			{ className: 'org.antlr.v4.runtime.atn.ATNConfig', instances: 10, bytes: 100 },
		]);
		expect(summarizeJavaHistogram(entries).categories).toStrictEqual([
			{ category: 'atn-dfa', bytes: 100, objects: 10 },
			{ category: 'containers', bytes: 400, objects: 20 },
		]);
	});

	it('sanitizes allocation profile script locations', () => {
		const summary = summarizeAllocationProfile(
			{
				head: {
					callFrame: { functionName: '', url: '', lineNumber: 0, columnNumber: 0 },
					selfSize: 0,
					children: [
						{
							callFrame: { functionName: 'getEpsilonTarget', url: 'file:///workspace/src/parser.ts', lineNumber: 1, columnNumber: 1 },
							selfSize: 1_024,
							children: [],
						},
						{
							callFrame: { functionName: 'outside', url: 'file:///other/place.ts', lineNumber: 1, columnNumber: 1 },
							selfSize: 512,
							children: [],
						},
					],
				},
			},
			'/workspace',
		);

		expect(summary.bytes).toBe(1_536);
		expect(summary.top).toStrictEqual([
			{ functionName: 'getEpsilonTarget', url: 'src/parser.ts', bytes: 1_024 },
			{ functionName: 'outside', url: 'place.ts', bytes: 512 },
		]);
	});

	it('aggregates repeated retained and allocation measurements', () => {
		const first = pass({ dfaRetainedBytes: 1_000, treeBytes: 300, tokenBytes: 100 });
		const second = pass({ dfaRetainedBytes: 1_010, treeBytes: 310, tokenBytes: 110 });
		const aggregate = aggregateMemoryPasses([first, second]);

		expect(aggregate.passes).toBe(2);
		expect(aggregate.dfaRetainedBytes.mean).toBe(1_005);
		expect(aggregate.treeBytes?.mean).toBe(305);
		expect(aggregate.dominantCategory).toStrictEqual({ category: 'atn-dfa', bytes: 6_000, share: 0.6 });
		expect(aggregate.repeatAgreement).toBeCloseTo(0.009_95, 4);
	});

	it('reports profiler overhead separately from uninstrumented timing', () => {
		const timing: TimingPass = { adapter: 'java', selection: 'tail', repetition: 1, files: 12, coreMs: 1_000, elapsedMs: 1_000, peakRssBytes: 1 };
		const overhead = profilerOverhead(timing, [pass({ dfaRetainedBytes: 1, treeBytes: 1, tokenBytes: 1 })]);

		expect(overhead.elapsedPercent).toBeCloseTo(10);
		expect(overhead.corePercent).toBeCloseTo(0);
	});
});

describe('memory publication', () => {
	it('rejects private absolute locations', () => {
		expect(() => assertPublishable({ path: '/Users/someone/repo' }, '/Users/someone/repo')).toThrow(/private location/u);
		expect(() => assertPublishable({ path: 'results/report.json' }, '/Users/someone/repo')).not.toThrow();
	});

	it('renders retained and allocation sections', () => {
		const report: MemoryReport = {
			schemaVersion: 1,
			experiment: '008-memory-profile',
			generatedAt: '2026-01-01T00:00:00.000Z',
			environment: {
				node: 'v26.10.0',
				platform: 'darwin',
				arch: 'arm64',
				release: '25.0.0',
				cpuModel: 'test',
				logicalCpus: 8,
				totalMemoryBytes: 1,
			},
			corpus: { id: 'private', sourceFiles: 12, sourceBytes: 1_000 },
			profilers: { 'v8-retained-deltas': ['forced-GC deltas'] },
			selections: [
				{
					mode: 'tail',
					criteria: '12 highest cost',
					fingerprint: 'abc',
					files: 12,
					bytes: 1_000,
					artifact: { kind: 'report', path: 'experiments/004/report.json', sha256: 'def' },
					adapters: [
						{
							adapter: 'java',
							uninstrumented: { adapter: 'java', selection: 'tail', repetition: 1, files: 12, coreMs: 1_000, elapsedMs: 1_000, peakRssBytes: 1 },
							instrumented: [pass({ dfaRetainedBytes: 1_000, treeBytes: 300, tokenBytes: 100 })],
							aggregate: aggregateMemoryPasses([pass({ dfaRetainedBytes: 1_000, treeBytes: 300, tokenBytes: 100 })]),
							overhead: {
								uninstrumentedElapsedMs: 1_000,
								instrumentedElapsedMs: 1_100,
								elapsedPercent: 10,
								uninstrumentedCoreMs: 1_000,
								instrumentedCoreMs: 1_000,
								corePercent: 0,
							},
						},
					],
				},
			],
			limitations: ['Forced garbage collection changes wall time.'],
		};

		const markdown = renderMemoryMarkdown(report);

		expect(markdown).toContain('DFA cache retained');
		expect(markdown).toContain('retained categories');
		expect(markdown).toContain('atn-dfa');
	});
});
