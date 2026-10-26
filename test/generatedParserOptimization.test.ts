import { CharStream, CommonTokenStream, ParserRuleContext, type ParseTree } from 'antlr4ng';
import { describe, expect, it } from 'vitest';

import { PlSqlLexer } from '../grammar/typescript/generated/PlSqlLexer.ts';
import { PlSqlParser } from '../grammar/typescript/generated/PlSqlParser.ts';
import { optimizeGeneralElementPart } from '../src/generatedParserOptimization.ts';

describe('optimizeGeneralElementPart', () => {
	it('replaces adaptive prediction while preserving the argument rule state', () => {
		const generated = `    public general_element_part(): General_element_partContext {
            let alternative: number;
            this.state = 20944;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2985, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 20941;
                    this.function_argument();
                    }
                    }
                }
                this.state = 20946;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 2985, this.context);
            }
    }`;

		const optimized = optimizeGeneralElementPart(generated);
		expect(optimized).toMatch(
			/while \(this\.tokenStream\.LA\(1\) === PlSqlParser\.LEFT_PAREN\) \{\s+alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, 2985, this\.context\);\s+if \(alternative !== 1\) \{\s+break;\s+\}\s+this\.state = 20941;\s+this\.function_argument\(\);\s+\}/u,
		);
		expect(optimized).toContain('let alternative');
	});

	it('rejects an unexpected generated parser shape', () => {
		expect(() => optimizeGeneralElementPart('')).toThrow(/did not match/u);
	});

	it.each([
		['begin x := foo; end;', 0],
		['begin x := foo(1); end;', 1],
		['begin x := foo(1)(2); end;', 2],
	] as const)('preserves function argument contexts for %s', (source, expectedArguments) => {
		const tokens = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
		const parser = new PlSqlParser(tokens);
		parser.removeErrorListeners();
		const tree = parser.sql_script();

		expect(parser.numberOfSyntaxErrors).toBe(0);
		expect(maxFunctionArguments(tree)).toBe(expectedArguments);
	});
});

const maxFunctionArguments = (tree: ParseTree): number => {
	const children = Array.from({ length: tree.getChildCount() }, (_, index) => tree.getChild(index)).filter((child): child is ParseTree => child !== null);
	const directArguments =
		tree instanceof ParserRuleContext && tree.ruleIndex === PlSqlParser.RULE_general_element_part
			? children.filter((child) => child instanceof ParserRuleContext && child.ruleIndex === PlSqlParser.RULE_function_argument).length
			: 0;
	return Math.max(directArguments, ...children.map(maxFunctionArguments));
};
