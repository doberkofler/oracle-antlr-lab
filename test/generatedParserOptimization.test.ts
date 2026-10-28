import { CharStream, CommonTokenStream, ParserRuleContext, type ParseTree } from 'antlr4ng';
import { describe, expect, it } from 'vitest';

import { PlSqlLexer } from '../grammar/typescript/generated/PlSqlLexer.ts';
import { PlSqlParser, Unary_expression_coreContext } from '../grammar/typescript/generated/PlSqlParser.ts';
import {
	optimizeBulkCollectAlias,
	optimizeCollectionMethodCall,
	optimizeGeneralElement,
	optimizeGeneralElementPart,
	optimizeGeneralElementPartPrediction,
	optimizeGeneratedParser,
	optimizeRoutineName,
	optimizeUnaryExpressionCore,
} from '../src/generatedParserOptimization.ts';

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

describe('optimizeGeneralElementPartPrediction', () => {
	it('resolves ordinary arguments and preserves the outer-join and TREAT paths', () => {
		const optimized = optimizeGeneralElementPartPrediction(gatedGeneralElementPartSource());

		expect(optimized).toContain('this.numberOfSyntaxErrors === 0');
		expect(optimized).toContain('this.tokenStream.LA(2) === PlSqlParser.PLUS_SIGN && this.tokenStream.LA(3) === PlSqlParser.RIGHT_PAREN');
		expect(optimized).toContain('this.tokenStream.LA(2) === PlSqlParser.TREAT');
		expect(optimized.match(/adaptivePredict\(this\.tokenStream, 2985/gu)).toHaveLength(2);
	});

	it('requires the guarded loop from optimizeGeneralElementPart', () => {
		expect(() => optimizeGeneralElementPartPrediction(generalElementPartSource())).toThrow(/gated shape/u);
	});

	it.each([
		['begin x := foo(1); end;', 1],
		['begin x := foo(+1); end;', 1],
		['begin x := foo(1)(2); end;', 2],
		['begin x := foo(TREAT(y AS JSON)); end;', 1],
		['select * from a, b where a.id = b.id(+);', 0],
	] as const)('preserves argument and non-argument parentheses for %s', (source, expectedArguments) => {
		const tokens = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
		const parser = new PlSqlParser(tokens);
		parser.removeErrorListeners();
		const tree = parser.sql_script();

		expect(parser.numberOfSyntaxErrors).toBe(0);
		expect(maxFunctionArguments(tree)).toBe(expectedArguments);
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

describe('optimizeCollectionMethodCall', () => {
	it('requires the general_element PERIOD gate first', () => {
		expect(() => optimizeCollectionMethodCall(generalElementSource())).toThrow(/run optimizeGeneralElement first/u);
	});

	it('resolves collection methods with full-context prediction', () => {
		const optimized = optimizeCollectionMethodCall(optimizeGeneralElement(generalElementSource()));

		expect(optimized.match(/this\.predictWithLl\(29(?:81|82)\)/gu)).toHaveLength(3);
		expect(optimized).toContain('this.tokenStream.LA(2) === PlSqlParser.DELETE');
		expect(optimized).toContain('this.tokenStream.LA(2) === PlSqlParser.EXTEND');
		expect(optimized).toContain('this.tokenStream.LA(2) === PlSqlParser.TRIM');
	});
});

describe('optimizeBulkCollectAlias', () => {
	it('skips only the alias decision before BULK COLLECT', () => {
		const optimized = optimizeBulkCollectAlias(selectListElementsSource());

		expect(optimized).toContain('this.tokenStream.LA(1) === PlSqlParser.BULK && this.tokenStream.LA(2) === PlSqlParser.COLLECT ? 2');
		expect(optimized).toContain('this.column_alias();');
		expect(optimized.match(/adaptivePredict\(this\.tokenStream, 2381/gu)).toHaveLength(1);
		expect(optimized).not.toContain('adaptivePredict(this.tokenStream, 2380, this.context) ) {');
	});

	it('rejects an unexpected generated parser shape', () => {
		expect(() => optimizeBulkCollectAlias('')).toThrow(/did not match/u);
	});
});

describe('optimizeUnaryExpressionCore', () => {
	it('selects from the first tokens and keeps the ambiguous alternatives predicted', () => {
		const optimized = optimizeUnaryExpressionCore(unaryExpressionCoreSource());

		expect(optimized).toContain('switch (this.unaryExpressionCoreAlternative(2595, 18636, 18635)) {');
		expect(optimized).toContain('PlSqlParser.unaryExpressionCoreStandardTokens(standardState).has(first)');
		expect(optimized).toContain('this.unaryExpressionCoreUsesModelingClause()');
		expect(optimized).toContain('PlSqlParser.unaryExpressionCoreAtomTokens(atomState).has(first)');
		expect(optimized).toContain('second === PlSqlParser.PERCENT_ISOPEN');
		expect(optimized).toContain('return 2;');
		expect(optimized).toContain('return 5;');
		expect(optimized.match(/adaptivePredict\(this\.tokenStream, decision, this\.context\)/gu)?.length).toBeGreaterThan(4);
	});

	it('rejects an unexpected generated parser shape', () => {
		expect(() => optimizeUnaryExpressionCore('')).toThrow(/did not match/u);
	});

	it.each([
		['begin x := case when 1 = 1 then 1 else 2 end; end;', 'Case_expressionContext'],
		['begin x := case (1 > 0) when true then 1 else 2 end; end;', 'Case_expressionContext'],
		['select 1 from dual where exists (select 1 from dual);', 'Quantified_expressionContext'],
		['begin x := foo(1); end;', 'AtomContext'],
		['begin x := foo; end;', 'AtomContext'],
		['select to_char(1), chr(65), nvl(a, b), sum(a) from t;', 'Standard_functionContext'],
		['begin x := c%isopen; end;', 'Standard_functionContext'],
		['begin x := sql%bulk_rowcount(1); end;', 'Implicit_cursor_expressionContext'],
		['begin x := :bind; end;', 'AtomContext'],
	] as const)('selects the expected alternative for %s', (source, expected) => {
		const tokens = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
		const parser = new PlSqlParser(tokens);
		parser.removeErrorListeners();
		const tree = parser.sql_script();

		expect(parser.numberOfSyntaxErrors).toBe(0);
		expect(unaryCoreAlternatives(tree)).toContain(expected);
	});

	it('keeps parsing and reporting invalid expressions', () => {
		for (const source of ['select - from dual /', 'select 1 + from dual /', 'begin x := 1 +; end;']) {
			const tokens = new CommonTokenStream(new PlSqlLexer(CharStream.fromString(source)));
			const parser = new PlSqlParser(tokens);
			parser.removeErrorListeners();
			parser.sql_script();

			expect(parser.numberOfSyntaxErrors).toBeGreaterThan(0);
		}
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

	it('applies dependent optimizations in their required order', () => {
		const source = `${generalElementSource()}`;
		const optimized = optimizeGeneratedParser(source, ['collectionMethodCall', 'generalElement']);

		expect(optimized.match(/this\.predictWithLl\(29(?:81|82)\)/gu)).toHaveLength(3);
	});

	it('applies the argument prediction transform to the guarded loop', () => {
		const source = gatedGeneralElementPartSource();
		const optimized = optimizeGeneratedParser(source, ['generalElementPartPrediction']);

		expect(optimized).toContain('this.numberOfSyntaxErrors === 0');
		expect(optimized.match(/adaptivePredict\(this\.tokenStream, 2985/gu)).toHaveLength(2);
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

const generalElementSource = (): string => `export class PlSqlParser extends PlSqlParserBase {
    public general_element(_p?: number): General_elementContext {
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2981, this.context);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 2982, this.context);
    }
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

const gatedGeneralElementPartSource = (): string => `    public general_element_part(): General_element_partContext {
            while (this.tokenStream.LA(1) === PlSqlParser.LEFT_PAREN) {
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 2985, this.context);
                if (alternative !== 1) {
                    break;
                }
                this.state = 20941;
                this.function_argument();
            }
    }`;

const selectListElementsSource = (): string => `    public select_list_elements(): Select_list_elementsContext {
            switch (this.interpreter.adaptivePredict(this.tokenStream, 2381, this.context) ) {
            case 1:
                {
                this.tableview_name();
                this.match(PlSqlParser.PERIOD);
                this.match(PlSqlParser.ASTERISK);
                }
                break;
            case 2:
                {
                this.expression();
                switch (this.interpreter.adaptivePredict(this.tokenStream, 2380, this.context) ) {
                case 1:
                    {
                    this.state = 17337;
                    this.column_alias();
                    }
                    break;
                }
                }
                break;
            }
    }`;

const unaryExpressionCoreSource = (): string => `    public unary_expression_core(): Unary_expression_coreContext {
        try {
            this.state = 18640;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 2595, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 18633;
                this.case_expression();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 18634;
                this.quantified_expression();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 18635;
                this.standard_function();
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 18636;
                if (!(this.IsNotNumericFunction())) {
                    throw this.createFailedPredicateException("this.IsNotNumericFunction()");
                }
                this.state = 18637;
                this.atom();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 18638;
                this.implicit_cursor_expression();
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 18639;
                this.selection_directive_expression();
                }
                break;
            }
        }
    }`;

const unaryCoreAlternatives = (tree: ParseTree): readonly string[] => {
	const children = Array.from({ length: tree.getChildCount() }, (_, index) => tree.getChild(index)).filter((child): child is ParseTree => child !== null);
	const own = tree instanceof Unary_expression_coreContext ? [tree.getChild(0)?.constructor.name ?? 'none'] : [];
	return [...own, ...children.flatMap(unaryCoreAlternatives)];
};

const maxFunctionArguments = (tree: ParseTree): number => {
	const children = Array.from({ length: tree.getChildCount() }, (_, index) => tree.getChild(index)).filter((child): child is ParseTree => child !== null);
	const directArguments =
		tree instanceof ParserRuleContext && tree.ruleIndex === PlSqlParser.RULE_general_element_part
			? children.filter((child) => child instanceof ParserRuleContext && child.ruleIndex === PlSqlParser.RULE_function_argument).length
			: 0;
	return Math.max(directArguments, ...children.map(maxFunctionArguments));
};
