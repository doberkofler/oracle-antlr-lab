import { describe, expect, it } from 'vitest';

import {
	decisionStateCounts,
	evictDfaAtBoundary,
	evictDfaDecisions,
	parseSelectiveDfaLimit,
	parseSelectiveDfaPolicy,
	parseSelectiveDfaSchedule,
	totalDfaStates,
} from '../grammar/typescript/dfaEviction.ts';
import { parseSource, treeSha256 } from '../grammar/typescript/parse.ts';

const source = `create or replace procedure p is
	l_total number := 0;
begin
	for r in (select object_id from user_objects order by object_id) loop
		l_total := l_total + r.object_id;
	end loop;
	dbms_output.put_line(l_total);
end p;
/`;
const entry = { id: 0, path: 'eviction.sql', file: 'eviction.sql', bytes: source.length, lines: 10, sha256: '0'.repeat(64) };

const parse = () => parseSource(source, entry, { treeHash: true });

const noHotDecisions = new Set<number>();

describe('selective DFA eviction policy', () => {
	it.each([undefined, 'never'])('disables a limit for %s', (value) => {
		expect(parseSelectiveDfaLimit(value, 'LAB_TEST')).toBeNull();
	});

	it('accepts positive limits', () => {
		expect(parseSelectiveDfaLimit('42', 'LAB_TEST')).toBe(42);
	});

	it.each(['0', '-1', '1.5', 'invalid'])('rejects invalid limit %s', (value) => {
		expect(() => parseSelectiveDfaLimit(value, 'LAB_TEST')).toThrow(/positive integer/u);
	});

	it('parses hot decisions', () => {
		expect(parseSelectiveDfaPolicy(undefined, undefined, undefined, '2993, 2251').hotDecisions).toEqual(new Set([2993, 2251]));
	});

	it('treats an empty hot list as unprotected', () => {
		expect(parseSelectiveDfaPolicy(undefined, undefined, undefined, ' ').hotDecisions.size).toBe(0);
	});

	it.each(['a', '-1', '1.5'])('rejects invalid hot decisions %s', (value) => {
		expect(() => parseSelectiveDfaPolicy(undefined, undefined, undefined, value)).toThrow(/comma-separated/u);
	});
});

describe('selective DFA eviction', () => {
	it('discards learned states without changing parse semantics', () => {
		const control = parse();
		const retainedBefore = totalDfaStates(control.parser);
		expect(retainedBefore).toBeGreaterThan(0);

		const eviction = evictDfaDecisions(control.parser, {
			hotDecisions: noHotDecisions,
			hotMaxStates: null,
			coldMaxStates: 0,
			totalMaxStates: null,
		});

		expect(eviction.decisions.length).toBeGreaterThan(0);
		expect(eviction.statesAfter).toBe(0);
		expect(totalDfaStates(control.parser)).toBe(0);

		const candidate = parse();

		expect(treeSha256(candidate.tree)).toBe(treeSha256(control.tree));
		expect(candidate.observation.parseDiagnostics).toBe(control.observation.parseDiagnostics);
		expect(candidate.observation.lexerDiagnostics).toBe(control.observation.lexerDiagnostics);
		expect(candidate.observation.prediction).toBe(control.observation.prediction);
	});

	it('preserves hot decisions from the cold bound', () => {
		const parsed = parse();
		const counts = decisionStateCounts(parsed.parser);
		const populated = counts.flatMap((states, decision) => (states > 0 ? [decision] : []));
		const hotDecision = populated.at(0);

		expect(hotDecision).toBeDefined();

		evictDfaDecisions(parsed.parser, {
			hotDecisions: new Set(hotDecision === undefined ? [] : [hotDecision]),
			hotMaxStates: null,
			coldMaxStates: 0,
			totalMaxStates: null,
		});

		const after = decisionStateCounts(parsed.parser);

		expect(after[hotDecision ?? 0]).toBe(counts[hotDecision ?? 0]);
		expect(after.filter((states) => states > 0)).toHaveLength(1);
	});

	it('applies the hot bound to hot decisions', () => {
		const parsed = parse();
		const counts = decisionStateCounts(parsed.parser);
		const populated = counts.flatMap((states, decision) => (states > 0 ? [decision] : []));
		const hotDecision = populated.at(0);

		expect(hotDecision).toBeDefined();

		evictDfaDecisions(parsed.parser, {
			hotDecisions: new Set(hotDecision === undefined ? [] : [hotDecision]),
			hotMaxStates: 0,
			coldMaxStates: null,
			totalMaxStates: null,
		});

		expect(decisionStateCounts(parsed.parser).filter((states) => states > 0)).toHaveLength(counts.filter((states) => states > 0).length - 1);
	});

	it('bounds the aggregate retained state count', () => {
		const parsed = parse();
		const target = Math.max(1, Math.floor(totalDfaStates(parsed.parser) / 4));
		const eviction = evictDfaDecisions(parsed.parser, {
			hotDecisions: noHotDecisions,
			hotMaxStates: null,
			coldMaxStates: null,
			totalMaxStates: target,
		});

		expect(eviction.statesBefore).toBeGreaterThan(target);
		expect(eviction.statesAfter).toBeLessThanOrEqual(target);
		expect(eviction.decisions.length).toBeGreaterThan(0);
	});

	it('does not evict when no trigger fires', () => {
		const parsed = parse();
		const schedule = parseSelectiveDfaSchedule(undefined, undefined, undefined, '1', undefined, undefined);

		expect(evictDfaAtBoundary(parsed.parser, 1, schedule)).toBeNull();
	});

	it('runs on the configured file interval', () => {
		const parsed = parse();
		const schedule = parseSelectiveDfaSchedule('2', undefined, undefined, '1', undefined, undefined);

		expect(evictDfaAtBoundary(parsed.parser, 1, schedule)).toBeNull();
		expect(evictDfaAtBoundary(parsed.parser, 2, schedule)?.decisions.length).toBeGreaterThan(0);
	});
});
