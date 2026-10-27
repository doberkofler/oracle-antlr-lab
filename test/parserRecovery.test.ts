import { CharStream, CommonTokenStream } from 'antlr4ng';
import { describe, expect, it } from 'vitest';

import { PlSqlLexer } from '../grammar/typescript/generated/PlSqlLexer.ts';
import { PlSqlParser } from '../grammar/typescript/generated/PlSqlParser.ts';
import { type FileEntry, parseSource } from '../grammar/typescript/parse.ts';

type ParseMode = 'sll' | 'll';

/**
 * Parses without an error listener so diagnostics are counted through the
 * parser's own error count.
 *
 * @param source - Oracle source.
 * @param mode - Prediction mode under test.
 * @returns Diagnostic count and a rule-name parse tree.
 */
const parse = (source: string, mode: ParseMode) => {
	const tokens = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
	const parser = new PlSqlParser(tokens);
	const interpreter = parser.interpreter;

	if (interpreter === null) {
		throw new Error('Parser interpreter is unavailable');
	}

	parser.removeErrorListeners();
	interpreter.predictionMode = mode === 'sll' ? 0 : 1;
	const tree = parser.sql_script();

	return { errors: parser.numberOfSyntaxErrors, tree: tree.toStringTree(parser) };
};

const modes: readonly ParseMode[] = ['sll', 'll'];

const parseProduction = (source: string): ReturnType<typeof parseSource>['observation'] => {
	const entry: FileEntry = {
		id: 0,
		path: 'fixture.sql',
		file: 'fixture.sql',
		bytes: source.length,
		lines: source.split('\n').length,
		sha256: '0'.repeat(64),
	};

	return parseSource(source, entry).observation;
};

describe('intended conformance differences stay observable', () => {
	it.each([
		'begin a.list.DELETE(1); a.list.EXTEND; a.list.TRIM; a.list.TRIM(1); end;',
		'begin SELECT Matchcode BULK COLLECT INTO aRoles FROM las_role WHERE id = 1; end;',
		'begin SELECT Matchcode BULK FROM las_role; end;',
	] as const)('completes the SLL pass without a full-file LL fallback for %s', (source) => {
		const observation = parseProduction(source);

		expect(observation.parseDiagnostics).toBe(0);
		expect(observation.prediction).toBe('sll');
		expect(observation.llAttempts).toBe(0);
	});
});

describe('collection-method recovery', () => {
	it.each(modes)('accepts collection methods in %s mode', (mode) => {
		const source = 'begin a.list.DELETE(1); a.list.EXTEND; a.list.TRIM; a.list.TRIM(1); end;';
		const sll = parse(source, 'sll');
		const ll = parse(source, 'll');

		expect(parse(source, mode).errors).toBe(0);
		expect(sll.tree).toBe(ll.tree);
	});

	it.each(modes)('keeps dotted field access available in %s mode', (mode) => {
		const source = 'begin x := a.delete; x := a.extend; x := a.trim; end;';
		const sll = parse(source, 'sll');
		const ll = parse(source, 'll');

		expect(parse(source, mode).errors).toBe(0);
		expect(sll.tree).toBe(ll.tree);
	});

	it.each(modes)('reports malformed collection arguments in %s mode', (mode) => {
		expect(parse('begin a.list.DELETE(1,); end;', mode).errors).toBeGreaterThan(0);
	});

	it.each(modes)('reports a collection method without its period in %s mode', (mode) => {
		expect(parse('begin a.list DELETE(1); end;', mode).errors).toBeGreaterThan(0);
	});
});

describe('BULK COLLECT recovery', () => {
	it.each(modes)('accepts BULK COLLECT INTO after a select list in %s mode', (mode) => {
		const source = 'begin SELECT Matchcode BULK COLLECT INTO aRoles FROM las_role WHERE id = 1; end;';
		const sll = parse(source, 'sll');
		const ll = parse(source, 'll');

		expect(parse(source, mode).errors).toBe(0);
		expect(sll.tree).toBe(ll.tree);
	});

	it.each(modes)('accepts BULK as a column alias in %s mode', (mode) => {
		const source = 'begin SELECT Matchcode BULK FROM las_role; end;';
		const sll = parse(source, 'sll');
		const ll = parse(source, 'll');

		expect(parse(source, mode).errors).toBe(0);
		expect(sll.tree).toBe(ll.tree);
	});

	it.each(modes)('reports an empty BULK COLLECT target in %s mode', (mode) => {
		expect(parse('begin SELECT x BULK COLLECT INTO FROM t; end;', mode).errors).toBeGreaterThan(0);
	});
});

describe('grammar support stays explicit', () => {
	it.each(modes)('reports an unsupported XMLTABLE PASSING alias in %s mode', (mode) => {
		const source = `declare
	c sys_refcursor;
begin
	open c for select * from xmltable(x passing y as "p" returning sequence by ref columns a path "a");
end;`;

		expect(parse(source, mode).errors).toBeGreaterThan(0);
	});

	it.each(modes)('reports DATE NULL in a record type in %s mode', (mode) => {
		expect(parse('create or replace package p as type r is record (a date null); end p;', mode).errors).toBeGreaterThan(0);
	});
});
