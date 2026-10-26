import { type MetricStatistics } from './types.ts';

/**
 * Computes distribution statistics. The method is linear interpolation between
 * order statistics and is stable for the small samples used by the lab.
 *
 * @param values - Observed values.
 * @returns Distribution statistics.
 */
export const statistics = (values: readonly number[]): MetricStatistics => {
	if (values.length === 0) {
		return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
	}

	const sorted = [...values].sort((left, right) => left - right);
	const percentile = (fraction: number): number => {
		const position = fraction * (sorted.length - 1);
		const lowerIndex = Math.floor(position);
		const upperIndex = Math.ceil(position);
		const lower = sorted[lowerIndex] ?? 0;
		const upper = sorted[upperIndex] ?? lower;

		return lower + (upper - lower) * (position - lowerIndex);
	};

	return {
		count: sorted.length,
		mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
		p50: percentile(0.5),
		p95: percentile(0.95),
		p99: percentile(0.99),
		max: sorted.at(-1) ?? 0,
	};
};

/**
 * Median of the supplied values.
 *
 * @param values - Observed values.
 * @returns Median, or zero for an empty list.
 */
export const median = (values: readonly number[]): number => statistics(values).p50;
