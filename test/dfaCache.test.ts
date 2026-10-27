import { describe, expect, it } from 'vitest';

import { parseDfaCachePolicy, parseDfaClearInterval } from '../grammar/typescript/dfaCache.ts';
import { parseSource, treeSha256 } from '../grammar/typescript/parse.ts';

describe('DFA cache policy', () => {
	it.each([undefined, 'never'])('keeps caches for %s', (value) => {
		expect(parseDfaClearInterval(value)).toBeNull();
	});

	it('accepts a positive file interval', () => {
		expect(parseDfaClearInterval('100')).toBe(100);
	});

	it.each(['0', '-1', '1.5', 'invalid'])('rejects invalid interval %s', (value) => {
		expect(() => parseDfaClearInterval(value)).toThrow(/positive integer/u);
	});

	it('parses a heap-pressure threshold', () => {
		expect(parseDfaCachePolicy(undefined, '3072')).toEqual({ clearEveryFiles: null, maxHeapBytes: 3072 * 1024 * 1024 });
	});

	it.each(['0', '-1', 'invalid'])('rejects invalid heap threshold %s', (value) => {
		expect(() => parseDfaCachePolicy(undefined, value)).toThrow(/positive number/u);
	});

	it('preserves parse structure and diagnostics after clearing', () => {
		const source = `create or replace procedure p is
	begin
		null;
	end p;
	/`;
		const entry = { id: 0, path: 'cache.sql', file: 'cache.sql', bytes: source.length, lines: 5, sha256: '0'.repeat(64) };
		const control = parseSource(source, entry);
		control.parser.interpreter?.clearDFA();
		const candidate = parseSource(source, entry);

		expect(treeSha256(candidate.tree)).toBe(treeSha256(control.tree));
		expect(candidate.observation.parseDiagnostics).toBe(control.observation.parseDiagnostics);
		expect(candidate.observation.lexerDiagnostics).toBe(control.observation.lexerDiagnostics);
	});
});
