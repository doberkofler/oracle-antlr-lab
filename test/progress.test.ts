import { describe, expect, it } from 'vitest';

import { createProgressReporter, formatDuration, formatPercentage, progressSnapshot } from '../src/progress.ts';

describe('formatDuration', () => {
	it('renders whole minutes and padded seconds', () => {
		expect(formatDuration(0)).toBe('0m 00s');
		expect(formatDuration(5_400)).toBe('0m 05s');
		expect(formatDuration(65_000)).toBe('1m 05s');
		expect(formatDuration(3_600_000)).toBe('60m 00s');
		expect(formatDuration(-1)).toBe('0m 00s');
	});
});

describe('formatPercentage', () => {
	it('renders one decimal place and clamps to the range', () => {
		expect(formatPercentage(0, 200)).toBe('0.0%');
		expect(formatPercentage(1, 3)).toBe('33.3%');
		expect(formatPercentage(200, 200)).toBe('100.0%');
		expect(formatPercentage(300, 200)).toBe('100.0%');
	});

	it('rejects a non-positive total', () => {
		expect(() => formatPercentage(0, 0)).toThrow(/positive/u);
	});
});

describe('progressSnapshot', () => {
	it('computes the completed fraction and a linear ETA', () => {
		const snapshot = progressSnapshot({ completed: 25, total: 100, elapsedMs: 5_000 });

		expect(snapshot.fraction).toBe(0.25);
		expect(snapshot.etaMs).toBe(15_000);
		expect(snapshot.completed).toBe(25);
		expect(snapshot.total).toBe(100);
	});

	it('has no ETA before the first unit and clamps over-completion', () => {
		expect(progressSnapshot({ completed: 0, total: 10, elapsedMs: 900 }).etaMs).toBeNull();

		const overrun = progressSnapshot({ completed: 20, total: 10, elapsedMs: 1_000 });
		expect(overrun.completed).toBe(10);
		expect(overrun.etaMs).toBe(0);
	});

	it('rejects a non-positive total', () => {
		expect(() => progressSnapshot({ completed: 0, total: 0, elapsedMs: 0 })).toThrow(/positive/u);
	});
});

describe('createProgressReporter', () => {
	const harness = (total: number, intervalMs = 2_000) => {
		const lines: string[] = [];
		let clock = 0;
		const reporter = createProgressReporter({
			label: 'conformance',
			total,
			unit: 'files',
			write: (line) => lines.push(line),
			now: () => clock,
			minimumIntervalMs: intervalMs,
		});

		return {
			lines,
			reporter,
			setClock: (value: number) => {
				clock = value;
			},
		};
	};

	it('emits the first update and throttles the rest', () => {
		const { lines, reporter, setClock } = harness(10);

		reporter.advance(1, 'state-a');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('[conformance] 1/10 files (10.0%) elapsed 0m 00s eta 0m 00s; state-a');

		setClock(1_000);
		reporter.advance(2, 'state-a');
		expect(lines).toHaveLength(1);

		setClock(2_000);
		reporter.advance(5, 'state-b');
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('5/10 files (50.0%)');
		expect(lines[1]).toContain('state-b');
	});

	it('always reports the final totals and keeps the last snapshot', () => {
		const { lines, reporter, setClock } = harness(4);

		setClock(4_000);
		reporter.advance(2);
		setClock(4_500);
		reporter.advance(3);
		expect(lines).toHaveLength(1);

		setClock(8_000);
		reporter.finish('all states');
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('4/4 files (100.0%)');
		expect(lines[1]).toContain('eta 0m 00s');
		expect(lines[1]).toContain('all states');
		expect(reporter.snapshot().completed).toBe(4);
	});
});
