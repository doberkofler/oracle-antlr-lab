import { describe, expect, it } from 'vitest';
import { median, statistics } from '../src/stats.ts';

describe('statistics', () => {
	it('returns zeroes for an empty sample', () => {
		expect(statistics([])).toStrictEqual({ count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
	});

	it('computes interpolated percentiles', () => {
		const result = statistics([1, 2, 3, 4]);

		expect(result.count).toBe(4);
		expect(result.mean).toBe(2.5);
		expect(result.p50).toBe(2.5);
		expect(result.p95).toBeCloseTo(3.85);
		expect(result.max).toBe(4);
	});

	it('uses the middle order statistic for an odd sample', () => {
		expect(median([9, 1, 5])).toBe(5);
	});
});
