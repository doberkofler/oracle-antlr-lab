import { CharStream, CommonTokenStream, ParserRuleContext, type ParseTree } from 'antlr4ng';
import { describe, expect, it } from 'vitest';

import { PlSqlLexer } from '../grammar/typescript/generated/PlSqlLexer.ts';
import { PlSqlParser } from '../grammar/typescript/generated/PlSqlParser.ts';
import { optimizeGeneralElement, optimizeGeneralElementPart, optimizeGeneratedParser, optimizeRoutineName } from '../src/generatedParserOptimization.ts';

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

	it.each([
		'begin x := a.b.c; end;',
		'begin a.b.c := 1; end;',
		'begin x := (a).b.c; end;',
		'begin a.list.DELETE(i); a.list.EXTEND; end;',
		'select t.* from t;',
	] as const)('accepts dotted and collection access for %s', (source) => {
		const tokens = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
		const parser = new PlSqlParser(tokens);
		parser.removeErrorListeners();
		parser.sql_script();

		expect(parser.numberOfSyntaxErrors).toBe(0);
	});
});

describe('optimizeRoutineName', () => {
	it('replaces the dotted-name loop prediction with a PERIOD check', () => {
		const generated = `    public routine_name(): Routine_nameContext {
        try {
            let alternative: number;
            this.identifier();
            this.state = 20420;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2901, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 20416;
                    this.match(PlSqlParser.PERIOD);
                    this.state = 20417;
                    this.id_expression();
                    }
                    }
                }
                this.state = 20422;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 2901, this.context);
            }
        }
    }`;

		const optimized = optimizeRoutineName(generated);
		expect(optimized).toContain('this.numberOfSyntaxErrors === 0');
		expect(optimized).toContain('this.atn.nextTokens(this.atn.states[20417]!)');
		expect(optimized).toContain('adaptivePredict(this.tokenStream, 2901');
		expect(optimized).toContain('this.match(PlSqlParser.PERIOD);');
		expect(optimized).toContain('this.id_expression();');
	});

	it('rejects an unexpected generated parser shape', () => {
		expect(() => optimizeRoutineName('')).toThrow(/did not match/u);
	});
});

describe('optimizeGeneralElement', () => {
	it('gates both dotted-part loop predictions with PERIOD', () => {
		const generated = `    public general_element(_p?: number): General_elementContext {
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
            while (alternative !== 2) {
                do {
                    this.general_element_part();
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 2981, this.context);
                } while (alternative !== 2);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
            }
    }`;

		const optimized = optimizeGeneralElement(generated);
		expect(optimized.match(/LA\(1\) === PlSqlParser\.PERIOD \? this\.interpreter\.adaptivePredict/gu)).toHaveLength(3);
		expect(optimized).toContain(': 2);');
	});

	it('rejects a method without the expected three predictions', () => {
		const generated = `    public general_element(): General_elementContext {
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
    }`;
		expect(() => optimizeGeneralElement(generated)).toThrow(/expected 3/u);
	});
});

describe('optimizeGeneratedParser', () => {
	it('applies only the selected optimizations', () => {
		const source = `${routineNameSource()}${generalElementSource()}${generalElementPartSource()}`;
		const optimized = optimizeGeneratedParser(source, ['routineName']);

		expect(optimized).toContain('this.numberOfSyntaxErrors === 0');
		expect(optimized).toContain('adaptivePredict(this.tokenStream, 2982');
		expect(optimized).toContain('adaptivePredict(this.tokenStream, 2985');
	});
});

const routineNameSource = (): string => `    public routine_name(): Routine_nameContext {
        try {
            let alternative: number;
            this.identifier();
            this.state = 20420;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2901, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 20416;
                    this.match(PlSqlParser.PERIOD);
                    this.state = 20417;
                    this.id_expression();
                    }
                    }
                }
                this.state = 20422;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 2901, this.context);
            }
        }
    }`;

const generalElementSource = (): string => `    public general_element(_p?: number): General_elementContext {
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2981, this.context);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
    }`;

const generalElementPartSource = (): string => `    public general_element_part(): General_element_partContext {
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
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 2985, this.context);
            }
    }`;

const maxFunctionArguments = (tree: ParseTree): number => {
	const children = Array.from({ length: tree.getChildCount() }, (_, index) => tree.getChild(index)).filter((child): child is ParseTree => child !== null);
	const directArguments =
		tree instanceof ParserRuleContext && tree.ruleIndex === PlSqlParser.RULE_general_element_part
			? children.filter((child) => child instanceof ParserRuleContext && child.ruleIndex === PlSqlParser.RULE_function_argument).length
			: 0;
	return Math.max(directArguments, ...children.map(maxFunctionArguments));
};
