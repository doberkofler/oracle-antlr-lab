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
		return {
			count: 0,
			min: 0,
			mean: 0,
			standardDeviation: 0,
			coefficientOfVariation: 0,
			meanCi95: { lower: 0, upper: 0 },
			p50: 0,
			p95: 0,
			p99: 0,
			max: 0,
		};
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

	const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
	const variance = sorted.length < 2 ? 0 : sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / (sorted.length - 1);
	const standardDeviation = Math.sqrt(variance);
	const bootstrapMeans = bootstrapSampleMeans(sorted);
	const bootstrapPercentile = (fraction: number): number => {
		const position = fraction * (bootstrapMeans.length - 1);
		const lowerIndex = Math.floor(position);
		const upperIndex = Math.ceil(position);
		const lower = bootstrapMeans[lowerIndex] ?? mean;
		const upper = bootstrapMeans[upperIndex] ?? lower;
		return lower + (upper - lower) * (position - lowerIndex);
	};

	return {
		count: sorted.length,
		min: sorted[0] ?? 0,
		mean,
		standardDeviation,
		coefficientOfVariation: mean === 0 ? 0 : standardDeviation / Math.abs(mean),
		meanCi95: { lower: bootstrapPercentile(0.025), upper: bootstrapPercentile(0.975) },
		p50: percentile(0.5),
		p95: percentile(0.95),
		p99: percentile(0.99),
		max: sorted.at(-1) ?? 0,
	};
};

const bootstrapSampleMeans = (values: readonly number[]): readonly number[] => {
	if (values.length === 1) {
		return [values[0] ?? 0];
	}

	let state = 0x9e3779b9;
	const samples = Array.from({ length: 10_000 }, () => {
		let total = 0;

		for (let index = 0; index < values.length; index += 1) {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
			const selectedIndex = Math.floor((state / 0x1_0000_0000) * values.length);
			total += values[selectedIndex] ?? 0;
		}

		return total / values.length;
	});

	return samples.sort((left, right) => left - right);
};

/**
 * Median of the supplied values.
 *
 * @param values - Observed values.
 * @returns Median, or zero for an empty list.
 */
export const median = (values: readonly number[]): number => statistics(values).p50;
