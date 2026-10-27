import { type PlSqlParser } from './generated/PlSqlParser.ts';

export type DfaCachePolicy = Readonly<{
	clearEveryFiles: number | null;
	maxHeapBytes: number | null;
}>;

/** Parses an optional positive cache-clear interval. */
export const parseDfaClearInterval = (value: string | undefined): number | null => {
	if (value === undefined || value === 'never') {
		return null;
	}

	const interval = Number(value);

	if (!Number.isInteger(interval) || interval < 1) {
		throw new Error(`LAB_DFA_CLEAR_EVERY must be a positive integer or "never", received ${value}`);
	}

	return interval;
};

/** Parses cache policy from the TypeScript harness environment. */
export const parseDfaCachePolicy = (clearEvery: string | undefined, maxHeapMiB: string | undefined): DfaCachePolicy => ({
	clearEveryFiles: parseDfaClearInterval(clearEvery),
	maxHeapBytes: parsePositiveNumber(maxHeapMiB, 'LAB_DFA_MAX_HEAP_MIB', 1024 * 1024),
});

/** Clears shared parser DFA state when a configured boundary is reached. */
export const clearDfaAtBoundary = (parser: PlSqlParser, completedFiles: number, policy: DfaCachePolicy): boolean => {
	const intervalReached = policy.clearEveryFiles !== null && completedFiles % policy.clearEveryFiles === 0;
	const heapLimitReached = policy.maxHeapBytes !== null && process.memoryUsage().heapUsed >= policy.maxHeapBytes;

	if (!intervalReached && !heapLimitReached) {
		return false;
	}

	const interpreter = parser.interpreter;

	if (interpreter === null) {
		throw new Error('Parser interpreter is unavailable');
	}

	interpreter.clearDFA();
	return true;
};

const parsePositiveNumber = (value: string | undefined, name: string, multiplier: number): number | null => {
	if (value === undefined || value === 'never') {
		return null;
	}

	const parsed = Number(value);

	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive number or "never", received ${value}`);
	}

	return parsed * multiplier;
};
