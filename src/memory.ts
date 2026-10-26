import { type MetricStatistics } from './types.ts';
import { statistics } from './stats.ts';

/** Attribution buckets shared by live-object memory summaries. */
export type MemoryCategory = 'parse-tree' | 'tokens' | 'atn-dfa' | 'containers' | 'strings' | 'code' | 'runtime' | 'other';

/** Bytes attributed to one category in a live-object summary. */
export type CategoryBytes = Readonly<{ category: MemoryCategory; bytes: number; objects: number }>;

/** One sanitized object owner from a live-object summary. */
export type OwnerBytes = Readonly<{ type: string; name: string; bytes: number; objects: number }>;

/** Live-object attribution at one measurement boundary. */
export type HeapSummary = Readonly<{
	source: 'jvm-class-histogram';
	totalBytes: number;
	objects: number;
	categories: readonly CategoryBytes[];
	topOwners: readonly OwnerBytes[];
}>;

/** Allocation attribution from a sampling profiler or thread allocation counter. */
export type AllocationSummary = Readonly<{
	source: 'v8-sampling-heap-profiler' | 'jvm-thread-allocation';
	bytes: number;
	samplingIntervalBytes: number | null;
	top: readonly Readonly<{ functionName: string; url: string; bytes: number }>[];
}>;

/** One per-file memory checkpoint. */
export type MemoryCheckpoint = Readonly<{
	file: string;
	position: number;
	coreMs: number;
	heapUsedBytes: number;
	retainedHeapBytes: number | null;
	rssBytes: number;
	dfaStates: number;
	allocatedBytes: number | null;
}>;

/** Retention of one representative file, measured by dropping references in stages. */
export type RetentionStages = Readonly<{
	file: string;
	tokens: number;
	withTreeBytes: number;
	withoutTreeBytes: number;
	withoutSourceBytes: number;
	withoutStreamBytes: number;
	treeBytes: number;
	sourceBytes: number;
	tokenBytes: number;
}>;

/** Evidence file kept outside the published report. */
export type MemoryEvidence = Readonly<{ name: string; bytes: number; sha256: string }>;

/** One completed memory pass. */
export type MemoryPass = Readonly<{
	adapter: string;
	selection: string;
	repetition: number;
	files: number;
	coreMs: number;
	elapsedMs: number;
	startupHeapBytes: number;
	retainedEndBytes: number;
	afterCacheClearBytes: number;
	afterParserDropBytes: number;
	peakRssBytes: number;
	peakHeapUsedBytes: number;
	dfa: Readonly<{ decisions: number; states: number; retainedBytes: number }>;
	retention: RetentionStages | null;
	representativeHeap: HeapSummary | null;
	allocation: AllocationSummary | null;
	heap: HeapSummary | null;
	checkpoints: readonly MemoryCheckpoint[];
	evidence: readonly MemoryEvidence[];
}>;

/** Harness output before adapter identity is attached. */
export type MemoryPassBody = Omit<MemoryPass, 'adapter' | 'selection' | 'repetition'>;

/** One uninstrumented timing pass used only for profiler-overhead accounting. */
export type TimingPass = Readonly<{
	adapter: string;
	selection: string;
	repetition: number;
	files: number;
	coreMs: number;
	elapsedMs: number;
	peakRssBytes: number;
}>;

/** Aggregate over repeated instrumented passes. */
export type MemoryAggregate = Readonly<{
	passes: number;
	coreMs: MetricStatistics;
	elapsedMs: MetricStatistics;
	startupHeapBytes: MetricStatistics;
	retainedEndBytes: MetricStatistics;
	afterCacheClearBytes: MetricStatistics;
	afterParserDropBytes: MetricStatistics;
	dfaRetainedBytes: MetricStatistics;
	dfaStates: MetricStatistics;
	peakRssBytes: MetricStatistics;
	sampledBytes: MetricStatistics;
	treeBytes: MetricStatistics | null;
	tokenBytes: MetricStatistics | null;
	dominantCategory: Readonly<{ category: MemoryCategory; bytes: number; share: number }> | null;
	repeatAgreement: number | null;
	allocationAgreement: number | null;
}>;

/** Instrumented versus uninstrumented cost. Reported separately; never mixed. */
export type ProfilerOverhead = Readonly<{
	uninstrumentedElapsedMs: number;
	instrumentedElapsedMs: number;
	elapsedPercent: number;
	uninstrumentedCoreMs: number;
	instrumentedCoreMs: number;
	corePercent: number;
}>;

/** One adapter within one selection. */
export type AdapterMemoryReport = Readonly<{
	adapter: string;
	uninstrumented: TimingPass;
	instrumented: readonly MemoryPass[];
	aggregate: MemoryAggregate;
	overhead: ProfilerOverhead;
}>;

/** One selection with all measured adapters. */
export type SelectionMemoryReport = Readonly<{
	mode: string;
	criteria: string;
	fingerprint: string;
	files: number;
	bytes: number;
	artifact: Readonly<{ kind: string; path: string | null; sha256: string }>;
	adapters: readonly AdapterMemoryReport[];
}>;

/** Complete memory experiment report. */
export type MemoryReport = Readonly<{
	schemaVersion: 1;
	experiment: string;
	generatedAt: string;
	environment: Readonly<{
		node: string;
		platform: string;
		arch: string;
		release: string;
		cpuModel: string;
		logicalCpus: number;
		totalMemoryBytes: number;
	}>;
	corpus: Readonly<{ id: string; sourceFiles: number; sourceBytes: number }>;
	profilers: Readonly<Record<string, readonly string[]>>;
	selections: readonly SelectionMemoryReport[];
	limitations: readonly string[];
}>;

const CATEGORY_ORDER: readonly MemoryCategory[] = ['parse-tree', 'tokens', 'atn-dfa', 'containers', 'strings', 'code', 'runtime', 'other'];

const safeName = (name: string): string => {
	const trimmed = name.replaceAll('\u0000', '').trim();
	return trimmed.length === 0 || trimmed.length > 160 || !/^[\w.$<>[\]()/+-;=]+$/u.test(trimmed) ? '<anonymous>' : trimmed;
};

/**
 * Maps a JVM class name to the shared attribution buckets.
 *
 * @param className - Binary class name from `GC.class_histogram`.
 * @returns Attribution category.
 */
export const categorizeJavaClass = (className: string): MemoryCategory => {
	if (/^\[Lorg\.antlr\.v4\.runtime\.(?:atn|dfa)\./u.test(className)) {
		return 'atn-dfa';
	}

	if (className.includes('FillerElement')) {
		return 'runtime';
	}

	if (/^\[[BCSIJZ]$|^\[L/u.test(className)) {
		return 'containers';
	}

	if (/(?:DFA|ATN|PredictionContext|PredictionContextCache|SemanticContext|LexerAction)/u.test(className)) {
		return 'atn-dfa';
	}

	if (/(?:Context|ParseTree|TerminalNodeImpl)/u.test(className)) {
		return 'parse-tree';
	}

	if (/(?:CommonToken|TokenStream|CharStream)$/u.test(className)) {
		return 'tokens';
	}

	if (className === 'java.lang.String' || className === 'java.lang.StringBuilder') {
		return 'strings';
	}

	if (/^(?:java\.util\.|java\.lang\.(?:Object|Integer|Long|Boolean))/u.test(className)) {
		return 'containers';
	}

	if (/^(?:java\.|jdk\.|sun\.)/u.test(className)) {
		return 'runtime';
	}

	return 'other';
};

type SamplingNode = Readonly<{
	callFrame: Readonly<{ functionName: string; url: string; lineNumber: number; columnNumber: number }>;
	selfSize: number;
	children: readonly SamplingNode[];
}>;

/**
 * Summarizes a V8 sampling heap profile.
 *
 * @param profile - `HeapProfiler.stopSampling` profile.
 * @param workspaceRoot - Repository root used to make script URLs relative.
 * @returns Sampled allocation attribution.
 */
export const summarizeAllocationProfile = (profile: Readonly<{ head: SamplingNode }>, workspaceRoot: string): AllocationSummary => {
	const allocations = new Map<string, { functionName: string; url: string; bytes: number }>();
	let totalBytes = 0;

	const visit = (node: SamplingNode): void => {
		if (node.selfSize > 0) {
			const functionName = safeName(node.callFrame.functionName === '' ? '<anonymous>' : node.callFrame.functionName);
			const url = sanitizeScriptUrl(node.callFrame.url, workspaceRoot);
			const key = `${functionName}\u0000${url}`;
			const value = allocations.get(key) ?? { functionName, url, bytes: 0 };
			value.bytes += node.selfSize;
			allocations.set(key, value);
			totalBytes += node.selfSize;
		}

		for (const child of node.children) {
			visit(child);
		}
	};

	visit(profile.head);

	return {
		source: 'v8-sampling-heap-profiler',
		bytes: totalBytes,
		samplingIntervalBytes: null,
		top: [...allocations.values()].sort((left, right) => right.bytes - left.bytes).slice(0, 15),
	};
};

const sanitizeScriptUrl = (url: string, workspaceRoot: string): string => {
	if (url === '') {
		return '(native)';
	}

	if (url.startsWith('node:')) {
		return url;
	}

	if (url.startsWith('file://')) {
		try {
			const relative = new URL(url).pathname;
			const prefix = `${workspaceRoot.split('\\').join('/')}/`;

			if (relative.startsWith(prefix)) {
				return relative.slice(prefix.length);
			}

			return relative.split('/').at(-1) ?? '<external>';
		} catch {
			return '<external>';
		}
	}

	return url.startsWith('webpack://') || url.startsWith('internal/') ? url : '<external>';
};

/**
 * Parses `jcmd GC.class_histogram` output.
 *
 * @param text - Command output.
 * @returns Class histogram entries sorted by descending bytes.
 */
export const parseJavaClassHistogram = (text: string): readonly Readonly<{ className: string; instances: number; bytes: number }>[] => {
	const entries: { className: string; instances: number; bytes: number }[] = [];

	for (const line of text.split(/\r?\n/u)) {
		const match = /^\s*\d+:\s+(\d+)\s+(\d+)\s+(.+?)(?:\s+\([^)]*\))?\s*$/u.exec(line);

		if (match === null) {
			continue;
		}

		const instances = Number(match[1]);
		const bytes = Number(match[2]);
		const className = match[3];

		if (Number.isFinite(instances) && Number.isFinite(bytes) && className !== undefined) {
			entries.push({ className, instances, bytes });
		}
	}

	return entries.sort((left, right) => right.bytes - left.bytes);
};

/**
 * Summarizes a JVM class histogram into the shared categories.
 *
 * @param entries - Parsed histogram entries.
 * @returns Live-object attribution.
 */
export const summarizeJavaHistogram = (entries: readonly Readonly<{ className: string; instances: number; bytes: number }>[]): HeapSummary => {
	const categories = new Map<MemoryCategory, { bytes: number; objects: number }>();
	let totalBytes = 0;
	let objectCount = 0;

	for (const entry of entries) {
		const category = categorizeJavaClass(entry.className);
		const value = categories.get(category) ?? { bytes: 0, objects: 0 };
		value.bytes += entry.bytes;
		value.objects += entry.instances;
		categories.set(category, value);
		totalBytes += entry.bytes;
		objectCount += entry.instances;
	}

	return {
		source: 'jvm-class-histogram',
		totalBytes,
		objects: objectCount,
		categories: CATEGORY_ORDER.flatMap((category) => {
			const value = categories.get(category);
			return value === undefined ? [] : [{ category, bytes: value.bytes, objects: value.objects }];
		}),
		topOwners: entries.slice(0, 15).map((entry) => ({
			type: 'class',
			name: safeName(entry.className),
			bytes: entry.bytes,
			objects: entry.instances,
		})),
	};
};

/**
 * Aggregates repeated memory passes.
 *
 * @param passes - Instrumented passes from one adapter and selection.
 * @returns Distribution statistics and repeat agreement.
 */
export const aggregateMemoryPasses = (passes: readonly MemoryPass[]): MemoryAggregate => {
	const retained = passes.map((pass) => pass.heap).filter((heap): heap is HeapSummary => heap !== null);
	const dominant = CATEGORY_ORDER.map((category) => ({
		category,
		bytes:
			retained.length === 0
				? 0
				: retained.reduce((total, heap) => total + (heap.categories.find((entry) => entry.category === category)?.bytes ?? 0), 0) / retained.length,
	})).sort((left, right) => right.bytes - left.bytes)[0];
	const totalRetained = retained.length === 0 ? 0 : retained.reduce((total, heap) => total + heap.totalBytes, 0) / retained.length;
	const dfaRetained = passes.map((pass) => pass.dfa.retainedBytes);
	const topAllocation = passes[0]?.allocation?.top[0];
	const allocationValues = passes.map((pass) =>
		topAllocation === undefined
			? 0
			: (pass.allocation?.top.find((entry) => entry.functionName === topAllocation.functionName && entry.url === topAllocation.url)?.bytes ?? 0),
	);
	const treeBytes = retentionValues(passes, (retention) => retention.treeBytes);
	const tokenBytes = retentionValues(passes, (retention) => retention.tokenBytes);

	return {
		passes: passes.length,
		coreMs: statistics(passes.map((pass) => pass.coreMs)),
		elapsedMs: statistics(passes.map((pass) => pass.elapsedMs)),
		startupHeapBytes: statistics(passes.map((pass) => pass.startupHeapBytes)),
		retainedEndBytes: statistics(passes.map((pass) => pass.retainedEndBytes)),
		afterCacheClearBytes: statistics(passes.map((pass) => pass.afterCacheClearBytes)),
		afterParserDropBytes: statistics(passes.map((pass) => pass.afterParserDropBytes)),
		dfaRetainedBytes: statistics(dfaRetained),
		dfaStates: statistics(passes.map((pass) => pass.dfa.states)),
		peakRssBytes: statistics(passes.map((pass) => pass.peakRssBytes)),
		sampledBytes: statistics(passes.map((pass) => pass.allocation?.bytes ?? 0)),
		treeBytes: treeBytes === null ? null : statistics(treeBytes),
		tokenBytes: tokenBytes === null ? null : statistics(tokenBytes),
		dominantCategory:
			dominant === undefined || totalRetained === 0
				? null
				: { category: dominant.category, bytes: dominant.bytes, share: dominant.bytes / totalRetained },
		repeatAgreement:
			dfaRetained.length < 2
				? null
				: Math.abs((dfaRetained[0] ?? 0) - (dfaRetained[1] ?? 0)) / Math.max(1, ((dfaRetained[0] ?? 0) + (dfaRetained[1] ?? 0)) / 2),
		allocationAgreement:
			topAllocation === undefined || allocationValues.length < 2
				? null
				: Math.abs((allocationValues[0] ?? 0) - (allocationValues[1] ?? 0)) /
					Math.max(1, ((allocationValues[0] ?? 0) + (allocationValues[1] ?? 0)) / 2),
	};
};

const retentionValues = (passes: readonly MemoryPass[], select: (retention: RetentionStages) => number): readonly number[] | null => {
	const retentions = passes.map((pass) => pass.retention);

	return retentions.every((retention): retention is RetentionStages => retention !== null) ? retentions.map(select) : null;
};

/**
 * Computes instrumented versus uninstrumented cost.
 *
 * @param timing - Uninstrumented pass.
 * @param passes - Instrumented passes.
 * @returns Absolute values and percent changes.
 */
export const profilerOverhead = (timing: TimingPass, passes: readonly MemoryPass[]): ProfilerOverhead => {
	const instrumentedElapsed = statistics(passes.map((pass) => pass.elapsedMs)).mean;
	const instrumentedCore = statistics(passes.map((pass) => pass.coreMs)).mean;

	return {
		uninstrumentedElapsedMs: timing.elapsedMs,
		instrumentedElapsedMs: instrumentedElapsed,
		elapsedPercent: timing.elapsedMs === 0 ? 0 : ((instrumentedElapsed - timing.elapsedMs) / timing.elapsedMs) * 100,
		uninstrumentedCoreMs: timing.coreMs,
		instrumentedCoreMs: instrumentedCore,
		corePercent: timing.coreMs === 0 ? 0 : ((instrumentedCore - timing.coreMs) / timing.coreMs) * 100,
	};
};

/**
 * Rejects unpublished absolute paths and source-bearing strings.
 *
 * @param value - Report to validate.
 * @param workspaceRoot - Repository root that must not appear.
 * @throws Error when a private path or file URL is present.
 */
export const assertPublishable = (value: unknown, workspaceRoot: string): void => {
	const serialized = JSON.stringify(value);
	const forbidden = [workspaceRoot, '/Users/', '/private/', '/corpus/', '.work/', 'file://'];

	for (const token of forbidden) {
		if (serialized.includes(token)) {
			throw new Error(`Published memory report contains a private location marker: ${token}`);
		}
	}
};

const formatBytes = (bytes: number): string => {
	if (bytes < 1_000) {
		return `${bytes.toFixed(0)} B`;
	}

	if (bytes < 1_000_000) {
		return `${(bytes / 1_000).toFixed(1)} kB`;
	}

	if (bytes < 1_000_000_000) {
		return `${(bytes / 1_000_000).toFixed(1)} MB`;
	}

	return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
};

const formatPercent = (value: number | null): string => (value === null ? '—' : `${(value * 100).toFixed(2)}%`);

/**
 * Renders a memory report as Markdown.
 *
 * @param report - Complete memory report.
 * @returns Markdown document.
 */
export const renderMemoryMarkdown = (report: MemoryReport): string => {
	const lines: string[] = [
		`# ${report.experiment}`,
		'',
		`Corpus ${report.corpus.id}: ${String(report.corpus.sourceFiles)} source files, ${formatBytes(report.corpus.sourceBytes)}. Generated ${report.generatedAt}.`,
		'',
		'Instrumented intervals are reported separately from uninstrumented parser timing. They are not comparable production benchmarks.',
		'',
	];

	for (const selection of report.selections) {
		lines.push(
			`## ${selection.mode}`,
			'',
			`${String(selection.files)} opaque files, ${formatBytes(selection.bytes)}; selection ${selection.fingerprint.slice(0, 16)}…; source ${selection.artifact.path ?? (selection.artifact.kind === 'private-manifest' ? 'private manifest (path withheld)' : 'in-memory')}.`,
			'',
			'| Adapter | Files | Core mean ms | Instrumented elapsed mean s | Elapsed overhead | Startup retained | Retained end | DFA cache retained | DFA share | Base retained after parser drop | DFA states first → last | Peak RSS | Dominant retained category | DFA repeat agreement | Allocation repeat agreement |',
			'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
		);

		for (const adapter of selection.adapters) {
			const aggregate = adapter.aggregate;
			lines.push(
				`| ${adapter.adapter} | ${String(adapter.instrumented[0]?.files ?? 0)} | ${aggregate.coreMs.mean.toFixed(3)} | ${(aggregate.elapsedMs.mean / 1_000).toFixed(3)} | ${adapter.overhead.elapsedPercent.toFixed(1)}% | ${formatBytes(aggregate.startupHeapBytes.mean)} | ${formatBytes(aggregate.retainedEndBytes.mean)} | ${formatBytes(aggregate.dfaRetainedBytes.mean)} | ${formatPercent(aggregate.retainedEndBytes.mean === 0 ? 0 : aggregate.dfaRetainedBytes.mean / aggregate.retainedEndBytes.mean)} | ${formatBytes(aggregate.afterParserDropBytes.mean)} | ${String(adapter.instrumented[0]?.checkpoints[0]?.dfaStates ?? 0)} → ${String(adapter.instrumented[0]?.checkpoints.at(-1)?.dfaStates ?? 0)} | ${formatBytes(aggregate.peakRssBytes.max)} | ${aggregate.dominantCategory === null ? '—' : `${aggregate.dominantCategory.category} (${formatPercent(aggregate.dominantCategory.share)})`} | ${formatPercent(aggregate.repeatAgreement)} | ${formatPercent(aggregate.allocationAgreement)} |`,
			);
		}

		lines.push(
			'',
			'| Adapter | Representative file | Parse tree | Token stream | Source text | Sampled allocations | Allocation source |',
			'| --- | --- | ---: | ---: | ---: | ---: | --- |',
		);

		for (const adapter of selection.adapters) {
			const first = adapter.instrumented[0];
			const retention = first?.retention ?? null;
			const allocation = first?.allocation ?? null;
			lines.push(
				`| ${adapter.adapter} | ${retention?.file ?? '—'} | ${retention === null ? '—' : formatBytes(adapter.aggregate.treeBytes?.mean ?? 0)} | ${retention === null ? '—' : formatBytes(adapter.aggregate.tokenBytes?.mean ?? 0)} | ${retention === null ? '—' : formatBytes(retention.sourceBytes)} | ${allocation === null ? '—' : formatBytes(allocation.bytes)} | ${allocation?.source ?? '—'} |`,
			);
		}

		for (const adapter of selection.adapters) {
			const heap = adapter.instrumented[0]?.heap ?? null;
			const allocation = adapter.instrumented[0]?.allocation ?? null;

			if (heap !== null) {
				lines.push(
					'',
					`### ${selection.mode} ${adapter.adapter} retained categories`,
					'',
					'| Category | Bytes | Share | Objects |',
					'| --- | ---: | ---: | ---: |',
					...heap.categories.map(
						(entry) =>
							`| ${entry.category} | ${formatBytes(entry.bytes)} | ${formatPercent(entry.bytes / Math.max(1, heap.totalBytes))} | ${String(entry.objects)} |`,
					),
				);
			}

			if (allocation !== null && allocation.top.length > 0) {
				lines.push(
					'',
					`### ${selection.mode} ${adapter.adapter} top allocation sites`,
					'',
					'| Function | Script | Sampled bytes |',
					'| --- | --- | ---: |',
					...allocation.top.map((entry) => `| ${entry.functionName} | ${entry.url} | ${formatBytes(entry.bytes)} |`),
				);
			}
		}

		lines.push(
			'',
			'Uninstrumented overhead reference:',
			'',
			'| Adapter | Uninstrumented elapsed s | Instrumented elapsed s | Elapsed change | Uninstrumented core ms | Instrumented core ms | Core change |',
			'| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
		);

		for (const adapter of selection.adapters) {
			lines.push(
				`| ${adapter.adapter} | ${(adapter.overhead.uninstrumentedElapsedMs / 1_000).toFixed(3)} | ${(adapter.overhead.instrumentedElapsedMs / 1_000).toFixed(3)} | ${adapter.overhead.elapsedPercent.toFixed(1)}% | ${adapter.overhead.uninstrumentedCoreMs.toFixed(3)} | ${adapter.overhead.instrumentedCoreMs.toFixed(3)} | ${adapter.overhead.corePercent.toFixed(1)}% |`,
			);
		}

		lines.push('');
	}

	lines.push(
		'## Method',
		'',
		...Object.entries(report.profilers).map(([name, details]) => `- **${name}:** ${details.join('; ')}.`),
		'',
		'Retained memory is measured after forced garbage collection. DFA cache retained bytes are the difference between the retained end state and the state after clearing the generated DFA tables. Per-file retention parses one representative file, then drops the parse tree, source text, and token stream in stages. Java drops the parser before the tree because `Parser.getContext()` retains the root context; its token figure therefore includes the parser frame released with the stream.',
		'',
		'Peak RSS is the process high-water mark recorded before profiles or reports are written. Class histogram self sizes are shallow and are not dominator-retained sizes; generic containers and runtime internals are not attributed to a parser owner.',
		'',
		'## Limitations',
		'',
		...report.limitations.map((limitation) => `- ${limitation}`),
		'',
	);

	return `${lines.join('\n')}\n`;
};
