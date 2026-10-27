import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PlSqlLexer } from '../grammar/typescript/generated/PlSqlLexer.ts';
import { tokenizeSource, tokenName } from '../grammar/typescript/tokenStream.ts';

const fixture = (name: string): string => readFileSync(path.join(import.meta.dirname, '..', 'corpora', 'fixtures', 'cross-runtime', name), 'utf8');
const isDirective = (name: string): boolean => name.startsWith('DOLLAR_');

describe('symbolic token streams', () => {
	it.each(['conditional-disabled.sql', 'conditional-enabled.sql', 'conditional-nested.sql'])('hides directives in %s', (name) => {
		const source = fixture(name);
		const raw = tokenizeSource(source, { conditional: false }).types.map(tokenName);
		const prepared = tokenizeSource(source).types.map(tokenName);

		expect(raw.filter(isDirective).length).toBeGreaterThan(0);
		expect(prepared.filter(isDirective)).toEqual([]);
	});

	it('resolves EOF and lexer symbolic names', () => {
		const directive = PlSqlLexer.symbolicNames.indexOf('DOLLAR_IF');

		expect(tokenName(-1)).toBe('EOF');
		expect(tokenName(directive)).toBe('DOLLAR_IF');
	});

	it('keeps source offsets out of the token signature', () => {
		const source = fixture('conditional-enabled.sql');
		const sequential = tokenizeSource(source);
		const repeated = tokenizeSource(source);

		expect(sequential).toEqual(repeated);
		expect(sequential.types.length).toBe(sequential.channels.length);
	});
});
