import { CommonToken, ParserRuleContext, type Token } from 'antlr4ng';
import { describe, expect, it } from 'vitest';
import { treeSha256Symbolic } from '../grammar/typescript/treeDigest.ts';

class TestRule extends ParserRuleContext {
	readonly #index: number;

	public constructor(index: number) {
		super(null, -1);
		this.#index = index;
	}

	public override get ruleIndex(): number {
		return this.#index;
	}
}

const root = (child: ParserRuleContext): ParserRuleContext => {
	const context = new TestRule(0);
	context.addChild(child);
	return context;
};

// antlr4ng declares Token.text as non-optional while CommonToken stores it as undefined.
const tokenOf = (type: number): Token => CommonToken.fromType(type) as unknown as Token;

const vocabulary = {
	ruleNames: ['root', 'wrapper', 'leaf'],
	symbolicNames: ['<INVALID>', 'SELECT', 'IDENTIFIER'],
	literalNames: ['<INVALID>', 'select', null],
};

describe('treeSha256Symbolic', () => {
	it('is stable when grammar revisions renumber rules and tokens', () => {
		const first = new TestRule(0);
		const firstLeaf = new TestRule(2);
		first.addChild(firstLeaf);
		firstLeaf.addTokenNode(tokenOf(2));

		const renumbered = new TestRule(1);
		const renumberedLeaf = new TestRule(0);
		renumbered.addChild(renumberedLeaf);
		renumberedLeaf.addTokenNode(tokenOf(1));

		const renumberedVocabulary = {
			ruleNames: ['leaf', 'root', 'wrapper'],
			symbolicNames: ['<INVALID>', 'IDENTIFIER', 'SELECT'],
			literalNames: ['<INVALID>', 'identifier', null],
		};

		expect(treeSha256Symbolic(first, vocabulary)).toBe(treeSha256Symbolic(renumbered, renumberedVocabulary));
	});

	it('flattens ignored wrapper rules', () => {
		const wrapper = new TestRule(1);
		wrapper.addTokenNode(tokenOf(1));
		const wrapped = root(wrapper);
		const direct = new TestRule(0);
		direct.addTokenNode(tokenOf(1));

		expect(treeSha256Symbolic(wrapped, vocabulary, { ignoredRules: ['wrapper'] })).toBe(treeSha256Symbolic(direct, vocabulary));
		expect(treeSha256Symbolic(wrapped, vocabulary)).not.toBe(treeSha256Symbolic(direct, vocabulary));
	});

	it('changes when a token name changes', () => {
		const select = new TestRule(0);
		select.addTokenNode(tokenOf(1));
		const identifier = new TestRule(0);
		identifier.addTokenNode(tokenOf(2));

		expect(treeSha256Symbolic(select, vocabulary)).not.toBe(treeSha256Symbolic(identifier, vocabulary));
	});
});
