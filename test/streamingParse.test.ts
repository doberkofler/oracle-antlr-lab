import { type ParseTreeListener } from 'antlr4ng';
import { describe, expect, it } from 'vitest';

import { type FileEntry, parseSource, parseSourceStreaming, type StreamingParseSink } from '../grammar/typescript/parse.ts';

const entryFor = (source: string): FileEntry => ({
	id: 0,
	path: 'stream.sql',
	file: 'stream.sql',
	bytes: Buffer.byteLength(source),
	lines: source.split('\n').length,
	sha256: '0'.repeat(64),
});

const listener = (onEnter: () => void): ParseTreeListener => ({
	visitTerminal: () => undefined,
	visitErrorNode: () => undefined,
	enterEveryRule: onEnter,
	exitEveryRule: () => undefined,
});

describe('streaming parse', () => {
	it('commits one clean SLL attempt without retaining a tree', () => {
		const source = 'select 1 from dual;';
		let entered = 0;
		const committed: string[] = [];
		const sink: StreamingParseSink = {
			listenerFor: () =>
				listener(() => {
					entered += 1;
				}),
			commit: (mode) => committed.push(mode),
			rollback: () => undefined,
		};

		const observation = parseSourceStreaming(source, entryFor(source), sink);

		expect(observation.parseDiagnostics).toBe(0);
		expect(entered).toBeGreaterThan(0);
		expect(committed).toEqual(['sll']);
	});

	it('preserves retained-tree observations', () => {
		const source = 'select 1 from dual;';
		const retained = parseSource(source, entryFor(source)).observation;
		const streaming = parseSourceStreaming(source, entryFor(source), {
			listenerFor: () => listener(() => undefined),
			commit: () => undefined,
			rollback: () => undefined,
		});

		expect(streaming.lexerDiagnostics).toBe(retained.lexerDiagnostics);
		expect(streaming.parseDiagnostics).toBe(retained.parseDiagnostics);
		expect(streaming.tokens).toBe(retained.tokens);
		expect(streaming.hiddenTokens).toBe(retained.hiddenTokens);
		expect(streaming.prediction).toBe(retained.prediction);
	});

	it('rolls back SLL events before committing LL recovery', () => {
		const source = 'alter table t;';
		const transactions: string[] = [];
		const sink: StreamingParseSink = {
			listenerFor: (mode) =>
				listener(() => {
					if (!transactions.includes(`events:${mode}`)) {
						transactions.push(`events:${mode}`);
					}
				}),
			commit: (mode) => transactions.push(`commit:${mode}`),
			rollback: (mode) => transactions.push(`rollback:${mode}`),
		};

		const observation = parseSourceStreaming(source, entryFor(source), sink);

		expect(observation.prediction).toBe('sll-fallback-ll');
		expect(transactions).toEqual(['events:sll', 'rollback:sll', 'events:ll', 'commit:ll']);
	});
});
