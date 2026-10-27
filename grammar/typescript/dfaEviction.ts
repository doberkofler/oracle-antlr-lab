import { DFA } from 'antlr4ng';

import { type PlSqlParser } from './generated/PlSqlParser.ts';

/** Per-decision bounds applied to the shared generated-parser DFA cache. */
export type SelectiveDfaPolicy = Readonly<{
	/** Decisions whose learned states are expensive to rebuild. */
	hotDecisions: ReadonlySet<number>;
	/** Retained-state bound for hot decisions; `null` leaves them unbounded. */
	hotMaxStates: number | null;
	/** Retained-state bound for every other decision. */
	coldMaxStates: number | null;
	/** Aggregate retained-state bound; the largest remaining decision is evicted first. */
	totalMaxStates: number | null;
}>;

/** One selective-eviction attempt. */
export type SelectiveDfaEviction = Readonly<{
	decisions: readonly number[];
	statesBefore: number;
	statesAfter: number;
}>;

/** Triggers that decide when selective bounds are enforced. */
export type SelectiveDfaSchedule = Readonly<{
	policy: SelectiveDfaPolicy;
	everyFiles: number | null;
	maxHeapBytes: number | null;
}>;

/** Parses an optional positive integer, accepting `never` as the disabled value. */
export const parseSelectiveDfaLimit = (value: string | undefined, name: string): number | null => {
	if (value === undefined || value === 'never') {
		return null;
	}

	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer or "never", received ${value}`);
	}

	return parsed;
};

/**
 * Parses selective DFA bounds and hot decisions.
 *
 * A hot decision is never evicted by the cold bound. It is only evicted by its
 * own hot bound or as the last resort of the aggregate bound.
 *
 * @param hotMaxStates - Retained-state limit for hot decisions.
 * @param coldMaxStates - Retained-state limit for every other decision.
 * @param totalMaxStates - Aggregate retained-state limit.
 * @param hotDecisions - Comma-separated decision numbers.
 * @returns Immutable selective policy.
 */
export const parseSelectiveDfaPolicy = (
	hotMaxStates: string | undefined,
	coldMaxStates: string | undefined,
	totalMaxStates: string | undefined,
	hotDecisions: string | undefined,
): SelectiveDfaPolicy => ({
	hotDecisions: parseDecisionList(hotDecisions),
	hotMaxStates: parseSelectiveDfaLimit(hotMaxStates, 'LAB_DFA_HOT_MAX_STATES'),
	coldMaxStates: parseSelectiveDfaLimit(coldMaxStates, 'LAB_DFA_COLD_MAX_STATES'),
	totalMaxStates: parseSelectiveDfaLimit(totalMaxStates, 'LAB_DFA_TOTAL_MAX_STATES'),
});

/**
 * Parses a selective schedule from the TypeScript harness environment.
 *
 * @param everyFiles - File interval between enforcement passes.
 * @param maxHeapMiB - Heap-pressure trigger in mebibytes.
 * @param hotMaxStates - Retained-state limit for hot decisions.
 * @param coldMaxStates - Retained-state limit for every other decision.
 * @param totalMaxStates - Aggregate retained-state limit.
 * @param hotDecisions - Comma-separated hot decision numbers.
 * @returns Immutable schedule; enforcement is disabled when both triggers are unset.
 */
export const parseSelectiveDfaSchedule = (
	everyFiles: string | undefined,
	maxHeapMiB: string | undefined,
	hotMaxStates: string | undefined,
	coldMaxStates: string | undefined,
	totalMaxStates: string | undefined,
	hotDecisions: string | undefined,
): SelectiveDfaSchedule => ({
	policy: parseSelectiveDfaPolicy(hotMaxStates, coldMaxStates, totalMaxStates, hotDecisions),
	everyFiles: parseSelectiveDfaLimit(everyFiles, 'LAB_DFA_SELECTIVE_EVERY'),
	maxHeapBytes: parseHeapMiB(maxHeapMiB, 'LAB_DFA_SELECTIVE_HEAP_MIB'),
});

/**
 * Enforces selective bounds at a configured file or heap boundary.
 *
 * @param parser - Parser whose interpreter owns the shared DFA array.
 * @param completedFiles - Files completed in the current pass.
 * @param schedule - Trigger and bound configuration.
 * @returns The eviction that ran, or `null` when no trigger fired.
 */
export const evictDfaAtBoundary = (parser: PlSqlParser, completedFiles: number, schedule: SelectiveDfaSchedule): SelectiveDfaEviction | null => {
	const intervalReached = schedule.everyFiles !== null && completedFiles % schedule.everyFiles === 0;
	const heapLimitReached = schedule.maxHeapBytes !== null && process.memoryUsage().heapUsed >= schedule.maxHeapBytes;

	if (!intervalReached && !heapLimitReached) {
		return null;
	}

	return evictDfaDecisions(parser, schedule.policy);
};

/** Returns retained state counts indexed by decision. */
export const decisionStateCounts = (parser: PlSqlParser): readonly number[] => parser.interpreter?.decisionToDFA.map((dfa) => dfa.length) ?? [];

/** Returns the number of states retained across all parser decisions. */
export const totalDfaStates = (parser: PlSqlParser): number => decisionStateCounts(parser).reduce((total, states) => total + states, 0);

/**
 * Evicts learned states for decisions that exceed the configured bounds.
 *
 * The parser interpreter and every parser created from the same generated class
 * share one `decisionToDFA` array. Replacing an entry therefore discards the
 * learned cache without rebuilding the parser or touching the generated grammar.
 *
 * @param parser - Parser whose interpreter owns the shared DFA array.
 * @param policy - Hot, cold, and aggregate state bounds.
 * @returns Decisions that were evicted and their before/after state totals.
 */
export const evictDfaDecisions = (parser: PlSqlParser, policy: SelectiveDfaPolicy): SelectiveDfaEviction => {
	const interpreter = parser.interpreter;

	if (interpreter === null) {
		throw new Error('Parser interpreter is unavailable');
	}

	const dfas = interpreter.decisionToDFA;
	const statesBefore = dfas.reduce((total, dfa) => total + dfa.length, 0);
	const evicted: number[] = [];

	for (const [decision, dfa] of dfas.entries()) {
		const bound = policy.hotDecisions.has(decision) ? policy.hotMaxStates : policy.coldMaxStates;

		if (bound !== null && dfa.length > bound) {
			dfas[decision] = new DFA(dfa.atnStartState, decision);
			evicted.push(decision);
		}
	}

	if (policy.totalMaxStates !== null) {
		let retained = dfas.reduce((total, dfa) => total + dfa.length, 0);

		while (retained > policy.totalMaxStates) {
			const largest = largestNonEmptyDecision(dfas);

			if (largest === null) {
				break;
			}

			const dfa = dfas[largest];
			retained -= dfa?.length ?? 0;
			dfas[largest] = new DFA(dfa?.atnStartState ?? null, largest);
			evicted.push(largest);
		}
	}

	return {
		decisions: evicted,
		statesBefore,
		statesAfter: dfas.reduce((total, dfa) => total + dfa.length, 0),
	};
};

const largestNonEmptyDecision = (dfas: readonly DFA[]): number | null => {
	let largestDecision: number | null = null;
	let largestStates = 0;

	for (const [decision, dfa] of dfas.entries()) {
		if (dfa.length > largestStates) {
			largestDecision = decision;
			largestStates = dfa.length;
		}
	}

	return largestDecision;
};

const parseDecisionList = (value: string | undefined): ReadonlySet<number> => {
	if (value === undefined || value.trim().length === 0) {
		return new Set();
	}

	const decisions = value.split(',').map((item) => Number(item.trim()));

	if (decisions.some((decision) => !Number.isInteger(decision) || decision < 0)) {
		throw new Error(`LAB_DFA_HOT_DECISIONS must be a comma-separated list of non-negative decisions, received ${value}`);
	}

	return new Set(decisions);
};

const parseHeapMiB = (value: string | undefined, name: string): number | null => {
	if (value === undefined || value === 'never') {
		return null;
	}

	const parsed = Number(value);

	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive number or "never", received ${value}`);
	}

	return parsed * 1024 * 1024;
};
