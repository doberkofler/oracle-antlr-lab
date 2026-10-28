import { writeSync } from 'node:fs';

/** Progress of a long-running unit of work, with an estimated completion time. */
export type ProgressSnapshot = Readonly<{
	completed: number;
	total: number;
	/** Completed fraction in `[0, 1]`. */
	fraction: number;
	elapsedMs: number;
	/** Remaining time at the observed average rate, or `null` before the first unit. */
	etaMs: number | null;
}>;

/**
 * Formats a duration as `0m 05s`.
 *
 * @param milliseconds - Elapsed or remaining time.
 * @returns Whole-minute duration with zero-padded seconds.
 */
export const formatDuration = (milliseconds: number): string => {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
};

/**
 * Formats a completion ratio with one decimal place.
 *
 * @param completed - Finished units.
 * @param total - Total units; must be positive.
 * @returns Percentage such as `42.0%`.
 */
export const formatPercentage = (completed: number, total: number): string => {
	if (!Number.isFinite(total) || total <= 0) {
		throw new Error(`Progress total must be positive, received ${String(total)}`);
	}

	return `${Math.min(100, Math.max(0, (completed / total) * 100)).toFixed(1)}%`;
};

/**
 * Derives progress and a linear ETA from the elapsed time.
 *
 * The estimate uses the average rate since the reporter started. It is `null`
 * until at least one unit has completed, because an early per-unit rate is not
 * meaningful.
 *
 * @param input - Completed units, total units, and elapsed time.
 * @returns Clamped snapshot with the remaining time.
 * @throws Error when the total is not positive.
 */
export const progressSnapshot = (input: Readonly<{ completed: number; total: number; elapsedMs: number }>): ProgressSnapshot => {
	if (!Number.isFinite(input.total) || input.total <= 0) {
		throw new Error(`Progress total must be positive, received ${String(input.total)}`);
	}
	const total = input.total;
	const completed = Math.min(Math.max(0, input.completed), total);
	const elapsedMs = Math.max(0, input.elapsedMs);
	const fraction = completed / total;
	const etaMs = completed === 0 ? null : (elapsedMs / completed) * (total - completed);

	return { completed, total, fraction, elapsedMs, etaMs };
};

/**
 * Writes one progress line to stderr without stream buffering.
 *
 * Corpus passes run inside a single synchronous loop, so a normal stream write
 * is flushed only when the loop ends. Writing the file descriptor directly
 * keeps the parent's ETA live during a long pass.
 *
 * @param line - Complete line, including its newline.
 */
export const writeProgressLine = (line: string): void => {
	writeSync(2, line);
};

/** Callback used to emit one rendered progress line. */
export type ProgressWriter = (line: string) => void;

/** Stateful progress reporter that throttles output and always reports completion. */
export type ProgressReporter = Readonly<{
	/** Reports newly completed units; output is rate-limited. */
	advance: (completed: number, detail?: string) => void;
	/** Reports the final state and flushes the line regardless of throttling. */
	finish: (detail?: string) => void;
	snapshot: () => ProgressSnapshot;
}>;

/**
 * Creates a reporter that renders overall progress, elapsed time, and ETA.
 *
 * One line is emitted at most every `minimumIntervalMs` (default two seconds)
 * and on the first update, so a long pass is never silent. `finish` always
 * emits, so the last line carries the totals even for a fast run.
 *
 * @param input - Label, total units, unit name, output sink, clock, and interval.
 * @returns Reporter with `advance`, `finish`, and `snapshot`.
 */
export const createProgressReporter = (
	input: Readonly<{
		label: string;
		total: number;
		unit?: string;
		write?: ProgressWriter;
		now?: () => number;
		minimumIntervalMs?: number;
	}>,
): ProgressReporter => {
	const unit = input.unit ?? 'items';
	const write = input.write ?? ((line: string) => process.stderr.write(line));
	const now = input.now ?? (() => performance.now());
	const intervalMs = input.minimumIntervalMs ?? 2_000;
	let startedAt: number | null = null;
	let lastWrittenAt: number | null = null;
	let lastCompleted = 0;

	const current = (completed: number): ProgressSnapshot => {
		const timestamp = now();
		startedAt ??= timestamp;
		return progressSnapshot({ completed, total: input.total, elapsedMs: timestamp - startedAt });
	};

	const render = (snapshot: ProgressSnapshot, detail: string | undefined): string => {
		const eta = snapshot.etaMs === null ? 'unknown' : formatDuration(snapshot.etaMs);
		const suffix = detail === undefined ? '' : `; ${detail}`;
		return `[${input.label}] ${String(snapshot.completed)}/${String(snapshot.total)} ${unit} (${formatPercentage(snapshot.completed, snapshot.total)}) elapsed ${formatDuration(snapshot.elapsedMs)} eta ${eta}${suffix}\n`;
	};

	const advance = (completed: number, detail?: string): void => {
		lastCompleted = completed;
		const timestamp = now();

		if (lastWrittenAt !== null && timestamp - lastWrittenAt < intervalMs) {
			return;
		}

		lastWrittenAt = timestamp;
		write(render(current(completed), detail));
	};

	const finish = (detail?: string): void => {
		lastCompleted = input.total;
		lastWrittenAt = now();
		write(render(current(input.total), detail));
	};

	return { advance, finish, snapshot: () => current(lastCompleted) };
};
