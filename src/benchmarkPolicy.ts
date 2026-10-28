import { createHash } from 'node:crypto';

import { parseDfaCachePolicy } from '../grammar/typescript/dfaCache.ts';
import { parseSelectiveDfaSchedule } from '../grammar/typescript/dfaEviction.ts';
import { type SelectionMode } from './selection.ts';

/** Effective heap limit of the runtime that executes the parser harness. */
export type HeapIdentity = Readonly<{
	limitBytes: number;
	limitMiB: number;
	/** Whether the limit came from `NODE_OPTIONS` or the runtime default. */
	origin: 'max-old-space-size' | 'v8-default';
	maxOldSpaceSizeMiB: number | null;
	nodeOptions: string | null;
}>;

/** Serialized DFA cache policy applied inside the parser harness. */
export type DfaCacheIdentity = Readonly<{
	mode: 'persistent' | 'periodic-clear' | 'selective-eviction';
	clearEveryFiles: number | null;
	clearAtHeapMiB: number | null;
	selective: Readonly<{
		everyFiles: number | null;
		atHeapMiB: number | null;
		hotDecisions: readonly number[];
		hotMaxStates: number | null;
		coldMaxStates: number | null;
		totalMaxStates: number | null;
	}> | null;
}>;

/** Benchmark execution identity that must match across compared campaigns. */
export type BenchmarkPolicy = Readonly<{
	schemaVersion: 1;
	heap: HeapIdentity;
	dfa: DfaCacheIdentity;
	fingerprint: string;
}>;

/** Policy recorded in a report; heap is absent in pre-issue-#22 reports. */
export type ReportPolicy = Readonly<{
	heap: HeapIdentity | null;
	dfa: DfaCacheIdentity;
}>;

/** Outcome of comparing the execution identity of two campaigns. */
export type PolicyComparison = Readonly<{
	matches: boolean | null;
	control: ReportPolicy | null;
	candidate: ReportPolicy | null;
	differences: readonly string[];
}>;

/** One preflight conclusion about the requested heap and cache configuration. */
export type HeapSafetyFinding = Readonly<{
	level: 'ok' | 'warning' | 'error';
	message: string;
}>;

/** File count at or above which a `full` selection is treated as the production corpus. */
export const FULL_CORPUS_FILE_THRESHOLD = 1_000;
/** Byte count at or above which any selection is treated as production scale. */
export const FULL_CORPUS_BYTE_THRESHOLD = 10_000_000;
/** Heap required by the persistent DFA cache on the production corpus. */
export const FULL_CORPUS_PERSISTENT_HEAP_MIB = 8_192;

const EMPTY_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {};

/**
 * Extracts the last `--max-old-space-size` value from `NODE_OPTIONS`.
 *
 * @param nodeOptions - Raw `NODE_OPTIONS` value, if set.
 * @returns Configured old-space size in mebibytes, or `null` when absent.
 */
export const parseMaxOldSpaceSizeMiB = (nodeOptions: string | undefined): number | null => {
	if (nodeOptions === undefined) {
		return null;
	}

	const tokens = nodeOptions
		.trim()
		.split(/\s+/u)
		.filter((token) => token.length > 0);
	let found: number | null = null;

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];

		if (token === undefined) {
			continue;
		}

		const inline = /^--max[-_]old[-_]space[-_]size=(?<value>\d+)$/u.exec(token);

		if (inline?.groups !== undefined) {
			found = Number(inline.groups['value']);
			continue;
		}

		if (token === '--max-old-space-size' || token === '--max_old_space_size') {
			const value = tokens[index + 1];

			if (value !== undefined && /^\d+$/u.test(value)) {
				found = Number(value);
				index += 1;
			}
		}
	}

	return found;
};

/**
 * Builds the heap identity from the effective limit and the environment.
 *
 * @param nodeOptions - Raw `NODE_OPTIONS` value.
 * @param limitBytes - `v8.getHeapStatistics().heap_size_limit` from the harness runtime.
 * @returns Recorded heap identity.
 */
export const heapIdentity = (nodeOptions: string | undefined, limitBytes: number): HeapIdentity => {
	if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
		throw new Error(`Effective heap limit must be positive, received ${String(limitBytes)}`);
	}

	const maxOldSpaceSizeMiB = parseMaxOldSpaceSizeMiB(nodeOptions);

	return {
		limitBytes,
		limitMiB: Math.round(limitBytes / (1024 * 1024)),
		origin: maxOldSpaceSizeMiB === null ? 'v8-default' : 'max-old-space-size',
		maxOldSpaceSizeMiB,
		nodeOptions: nodeOptions === undefined ? null : nodeOptions,
	};
};

/**
 * Reads the DFA cache policy the harness will apply.
 *
 * Triggers without bounds, or bounds without triggers, leave the cache
 * persistent because no eviction can run.
 *
 * @param environment - Environment variables visible to the harness.
 * @returns Serialized cache identity.
 * @throws Error when a policy value is invalid.
 */
export const dfaCacheIdentity = (environment: Readonly<Record<string, string | undefined>>): DfaCacheIdentity => {
	const cache = parseDfaCachePolicy(environment['LAB_DFA_CLEAR_EVERY'], environment['LAB_DFA_MAX_HEAP_MIB']);
	const schedule = parseSelectiveDfaSchedule(
		environment['LAB_DFA_SELECTIVE_EVERY'],
		environment['LAB_DFA_SELECTIVE_HEAP_MIB'],
		environment['LAB_DFA_HOT_MAX_STATES'],
		environment['LAB_DFA_COLD_MAX_STATES'],
		environment['LAB_DFA_TOTAL_MAX_STATES'],
		environment['LAB_DFA_HOT_DECISIONS'],
	);
	const selectiveHasTrigger = schedule.everyFiles !== null || schedule.maxHeapBytes !== null;
	const selectiveHasBound = schedule.policy.hotMaxStates !== null || schedule.policy.coldMaxStates !== null || schedule.policy.totalMaxStates !== null;
	const selectiveActive = selectiveHasTrigger && selectiveHasBound;
	const clearActive = cache.clearEveryFiles !== null || cache.maxHeapBytes !== null;

	return {
		mode: selectiveActive ? 'selective-eviction' : clearActive ? 'periodic-clear' : 'persistent',
		clearEveryFiles: cache.clearEveryFiles,
		clearAtHeapMiB: cache.maxHeapBytes === null ? null : Math.round(cache.maxHeapBytes / (1024 * 1024)),
		selective: selectiveActive
			? {
					everyFiles: schedule.everyFiles,
					atHeapMiB: schedule.maxHeapBytes === null ? null : Math.round(schedule.maxHeapBytes / (1024 * 1024)),
					hotDecisions: [...schedule.policy.hotDecisions].sort((left, right) => left - right),
					hotMaxStates: schedule.policy.hotMaxStates,
					coldMaxStates: schedule.policy.coldMaxStates,
					totalMaxStates: schedule.policy.totalMaxStates,
				}
			: null,
	};
};

/**
 * Builds the complete benchmark execution identity.
 *
 * @param nodeOptions - Raw `NODE_OPTIONS` value.
 * @param limitBytes - Effective heap limit of the harness runtime.
 * @param environment - Environment variables visible to the harness.
 * @returns Identity with a stable fingerprint.
 */
export const benchmarkPolicy = (
	nodeOptions: string | undefined,
	limitBytes: number,
	environment: Readonly<Record<string, string | undefined>> = EMPTY_ENVIRONMENT,
): BenchmarkPolicy => {
	const heap = heapIdentity(nodeOptions, limitBytes);
	const dfa = dfaCacheIdentity(environment);

	return {
		schemaVersion: 1,
		heap,
		dfa,
		fingerprint: policyFingerprint({ heap, dfa }),
	};
};

/**
 * Stable fingerprint over the dimensions that make campaigns comparable.
 *
 * Raw `NODE_OPTIONS` text is excluded so irrelevant flag ordering does not
 * create a mismatch; the effective limit and cache values are included.
 *
 * @param policy - Heap and DFA identity.
 * @returns SHA-256 hex digest.
 */
export const policyFingerprint = (policy: Readonly<{ heap: HeapIdentity; dfa: DfaCacheIdentity }>): string =>
	createHash('sha256')
		.update(
			JSON.stringify({
				heap: {
					limitBytes: policy.heap.limitBytes,
					origin: policy.heap.origin,
					maxOldSpaceSizeMiB: policy.heap.maxOldSpaceSizeMiB,
				},
				dfa: policy.dfa,
			}),
		)
		.digest('hex');

/**
 * Compares two recorded execution identities.
 *
 * @param control - Control policy, or `null` when the report does not record one.
 * @param candidate - Candidate policy, or `null` when the report does not record one.
 * @returns Match state. `null` means at least one heap identity is unknown.
 */
export const comparePolicy = (control: ReportPolicy | null, candidate: ReportPolicy | null): PolicyComparison => {
	const differences: string[] = [];

	if (control !== null && candidate !== null) {
		if (!sameDfa(control.dfa, candidate.dfa)) {
			differences.push(`DFA cache policy differs: control ${describeDfa(control.dfa)}, candidate ${describeDfa(candidate.dfa)}`);
		}

		if (control.heap !== null && candidate.heap !== null && control.heap.limitBytes !== candidate.heap.limitBytes) {
			differences.push(
				`heap limit differs: control ${String(control.heap.limitMiB)} MiB (${control.heap.origin}), candidate ${String(candidate.heap.limitMiB)} MiB (${candidate.heap.origin})`,
			);
		}
	}

	const heapKnown = control?.heap !== null && control?.heap !== undefined && candidate?.heap !== null && candidate?.heap !== undefined;
	const matches = differences.length > 0 ? false : control === null || candidate === null || !heapKnown ? null : true;

	return { matches, control, candidate, differences };
};

/**
 * Assesses whether the requested campaign can be expected to complete.
 *
 * Only the persistent cache on production-scale selections requires the larger
 * benchmark heap. Bounded policies completed under the default heap in
 * experiments 017 and 018.
 *
 * @param input - Recorded policy, selection mode, and selected size.
 * @returns Findings; an `error` blocks the campaign unless overridden.
 */
export const assessHeapSafety = (
	input: Readonly<{ policy: BenchmarkPolicy; mode: SelectionMode; files: number; bytes: number }>,
): readonly HeapSafetyFinding[] => {
	const productionScale = input.files >= FULL_CORPUS_FILE_THRESHOLD || (input.mode === 'full' && input.bytes >= FULL_CORPUS_BYTE_THRESHOLD);

	if (input.policy.dfa.mode !== 'persistent') {
		return [
			{
				level: 'ok',
				message: `${input.policy.dfa.mode} keeps the DFA cache bounded; the default heap is permitted.`,
			},
		];
	}

	if (productionScale && input.policy.heap.limitMiB < FULL_CORPUS_PERSISTENT_HEAP_MIB) {
		return [
			{
				level: 'error',
				message:
					`persistent DFA cache on ${String(input.files)} files needs at least ${String(FULL_CORPUS_PERSISTENT_HEAP_MIB)} MiB of V8 heap, ` +
					`but the harness limit is ${String(input.policy.heap.limitMiB)} MiB (${input.policy.heap.origin}). ` +
					'Set NODE_OPTIONS=--max-old-space-size=8192 (a parent --max-old-space-size flag is not inherited by the harness child), ' +
					'or enable a bounded policy with LAB_DFA_SELECTIVE_EVERY and its bounds, ' +
					'or pass --allow-unsafe-heap to run anyway. The benchmark never raises the heap automatically.',
			},
		];
	}

	if (input.mode === 'q4' && input.policy.heap.limitMiB < FULL_CORPUS_PERSISTENT_HEAP_MIB) {
		return [
			{
				level: 'warning',
				message: `Q4 contains the largest files; the persistent cache may approach the ${String(input.policy.heap.limitMiB)} MiB heap limit. Prefer --max-old-space-size=8192 for Q4 campaigns.`,
			},
		];
	}

	return [{ level: 'ok', message: `persistent DFA cache with a ${String(input.policy.heap.limitMiB)} MiB heap is permitted for ${input.mode}.` }];
};

/**
 * Parses the policy recorded in a production report.
 *
 * @param configValue - `config` object from a report.
 * @returns Recorded policy, or `null` when the report predates policy identity.
 * @throws Error when a recorded policy is malformed.
 */
export const parseReportPolicy = (configValue: unknown): ReportPolicy | null => {
	const config = asRecord(configValue);

	if (config === null) {
		return null;
	}

	const recorded = config['typeScriptPolicy'];

	if (recorded !== undefined) {
		const policy = asRecord(recorded);
		const heap = policy === null ? null : parseHeapIdentity(policy['heap']);
		const dfa = policy === null ? null : parseDfaIdentity(policy['dfa']);

		if (heap === null || dfa === null) {
			throw new Error('config.typeScriptPolicy is malformed');
		}

		return { heap, dfa };
	}

	const legacyClear = config['typeScriptDfaClearEveryFiles'];
	const legacyHeap = config['typeScriptDfaMaxHeapMiB'];

	if (typeof legacyClear === 'string' || typeof legacyHeap === 'string') {
		return {
			heap: null,
			dfa: dfaCacheIdentity({
				LAB_DFA_CLEAR_EVERY: typeof legacyClear === 'string' ? legacyClear : undefined,
				LAB_DFA_MAX_HEAP_MIB: typeof legacyHeap === 'string' ? legacyHeap : undefined,
			}),
		};
	}

	return null;
};

/**
 * Describes a recorded policy for operator output and report text.
 *
 * @param policy - Recorded policy.
 * @returns Single-line description.
 */
export const describePolicy = (policy: ReportPolicy): string => {
	const heap =
		policy.heap === null
			? 'heap not recorded'
			: `${String(policy.heap.limitMiB)} MiB heap (${policy.heap.origin}${policy.heap.maxOldSpaceSizeMiB === null ? '' : ` ${String(policy.heap.maxOldSpaceSizeMiB)} MiB`})`;

	return `${heap}; ${describeDfa(policy.dfa)}`;
};

const describeDfa = (dfa: DfaCacheIdentity): string => {
	if (dfa.mode === 'persistent') {
		return 'persistent DFA cache';
	}

	if (dfa.mode === 'periodic-clear') {
		return `periodic DFA clear every ${String(dfa.clearEveryFiles ?? 'never')} files / ${String(dfa.clearAtHeapMiB ?? 'never')} MiB`;
	}

	const selective = dfa.selective;

	return selective === null
		? 'selective DFA eviction'
		: `selective DFA eviction every ${String(selective.everyFiles ?? 'never')} files / ${String(selective.atHeapMiB ?? 'never')} MiB; hot ${selective.hotDecisions.join(',') || 'none'} at ${String(selective.hotMaxStates ?? 'unbounded')}, cold at ${String(selective.coldMaxStates ?? 'unbounded')}`;
};

const sameDfa = (left: DfaCacheIdentity, right: DfaCacheIdentity): boolean => JSON.stringify(left) === JSON.stringify(right);

const parseHeapIdentity = (value: unknown): HeapIdentity | null => {
	const record = asRecord(value);

	if (record === null) {
		return null;
	}

	const limitBytes = asPositiveNumber(record['limitBytes']);
	const limitMiB = asPositiveNumber(record['limitMiB']);
	const origin = record['origin'];

	if (limitBytes === null || limitMiB === null || (origin !== 'max-old-space-size' && origin !== 'v8-default')) {
		return null;
	}

	return {
		limitBytes,
		limitMiB,
		origin,
		maxOldSpaceSizeMiB: asNullablePositiveNumber(record['maxOldSpaceSizeMiB']),
		nodeOptions: asNullableString(record['nodeOptions']),
	};
};

const parseDfaIdentity = (value: unknown): DfaCacheIdentity | null => {
	const record = asRecord(value);

	if (record === null) {
		return null;
	}

	const mode = record['mode'];

	if (mode !== 'persistent' && mode !== 'periodic-clear' && mode !== 'selective-eviction') {
		return null;
	}

	const clearEveryFiles = asNullablePositiveNumber(record['clearEveryFiles']);
	const clearAtHeapMiB = asNullablePositiveNumber(record['clearAtHeapMiB']);
	const selectiveValue = record['selective'];
	let selective: DfaCacheIdentity['selective'] = null;

	if (selectiveValue !== null && selectiveValue !== undefined) {
		const entry = asRecord(selectiveValue);
		const hotDecisions = entry === null ? null : asNumberArray(entry['hotDecisions']);

		if (entry === null || hotDecisions === null) {
			return null;
		}

		selective = {
			everyFiles: asNullablePositiveNumber(entry['everyFiles']),
			atHeapMiB: asNullablePositiveNumber(entry['atHeapMiB']),
			hotDecisions,
			hotMaxStates: asNullablePositiveNumber(entry['hotMaxStates']),
			coldMaxStates: asNullablePositiveNumber(entry['coldMaxStates']),
			totalMaxStates: asNullablePositiveNumber(entry['totalMaxStates']),
		};
	}

	return { mode, clearEveryFiles, clearAtHeapMiB, selective };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asPositiveNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

const asNullablePositiveNumber = (value: unknown): number | null => {
	if (value === null || value === undefined) {
		return null;
	}

	return asPositiveNumber(value);
};

const asNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const asNumberArray = (value: unknown): readonly number[] | null =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isInteger(entry)) ? (value as readonly number[]) : null;
