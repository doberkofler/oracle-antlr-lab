const GENERAL_ELEMENT_PART_METHOD =
	/(?<prefix>    public general_element_part\(\): General_element_partContext \{[\s\S]*?)(?<loop>            this\.state = \d+;\n            this\.errorHandler\.sync\(this\);\n            alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\);\n            while \(alternative !== 2 && alternative !== antlr\.ATN\.INVALID_ALT_NUMBER\) \{\n                if \(alternative === 1\) \{\n                    \{\n                    \{\n                    this\.state = (?<argumentState>\d+);\n                    this\.function_argument\(\);\n                    \}\n                    \}\n                \}\n                this\.state = \d+;\n                this\.errorHandler\.sync\(this\);\n                alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, \d+, this\.context\);\n            \})(?<suffix>[\s\S]*?^    \})/mu;

/**
 * Skips context-sensitive argument-loop prediction when its consuming alternative cannot match.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @returns Source with the `function_argument` loop gated by `LEFT_PAREN`.
 */
export const optimizeGeneralElementPart = (source: string): string => {
	const match = GENERAL_ELEMENT_PART_METHOD.exec(source);

	if (match?.groups === undefined) {
		throw new Error('Generated general_element_part loop did not match the expected ANTLR shape');
	}
	const argumentState = match.groups['argumentState'];
	const decision = match.groups['decision'];
	const matchedPrefix = match.groups['prefix'];
	const suffix = match.groups['suffix'];

	if (argumentState === undefined || decision === undefined || matchedPrefix === undefined || suffix === undefined) {
		throw new Error('Generated general_element_part loop has incomplete captures');
	}

	const replacement = [
		'            while (this.tokenStream.LA(1) === PlSqlParser.LEFT_PAREN) {',
		`                alternative = this.interpreter.adaptivePredict(this.tokenStream, ${decision}, this.context);`,
		'                if (alternative !== 1) {',
		'                    break;',
		'                }',
		`                this.state = ${argumentState};`,
		'                this.function_argument();',
		'            }',
	].join('\n');

	return source.replace(GENERAL_ELEMENT_PART_METHOD, `${matchedPrefix}${replacement}${suffix}`);
};

const GENERAL_ELEMENT_PART_ARGUMENT_LOOP =
	/(?<prefix>    public general_element_part\(\): General_element_partContext \{[\s\S]*?)(?<loop>            while \(this\.tokenStream\.LA\(1\) === PlSqlParser\.LEFT_PAREN\) \{\n                alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\);\n                if \(alternative !== 1\) \{\n                    break;\n                \}\n                this\.state = (?<argumentState>\d+);\n                this\.function_argument\(\);\n            \})(?<suffix>[\s\S]*?^    \})/mu;

/**
 * Resolves the `general_element_part` argument loop without adaptive prediction.
 *
 * The loop is entered only when `LEFT_PAREN` follows. Oracle's outer-join marker
 * `(+)` is the only common construct that must leave the parenthesis to the
 * caller, so it exits directly. `TREAT` keeps context-sensitive prediction
 * because its parenthesized syntax is not a function-argument list. Every other
 * parenthesis is an argument list on accepted input. After a syntax error the
 * original prediction still runs so recovery behavior is unchanged.
 *
 * Requires {@link optimizeGeneralElementPart} to be applied first.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @returns Source whose argument loop avoids prediction for ordinary calls.
 */
export const optimizeGeneralElementPartPrediction = (source: string): string => {
	const match = GENERAL_ELEMENT_PART_ARGUMENT_LOOP.exec(source);

	if (match?.groups === undefined) {
		throw new Error('Generated general_element_part loop did not match the gated shape; run optimizeGeneralElementPart first');
	}
	const decision = match.groups['decision'];
	const argumentState = match.groups['argumentState'];
	const matchedPrefix = match.groups['prefix'];
	const suffix = match.groups['suffix'];

	if (decision === undefined || argumentState === undefined || matchedPrefix === undefined || suffix === undefined) {
		throw new Error('Generated general_element_part loop has incomplete captures');
	}

	const prediction = `this.interpreter.adaptivePredict(this.tokenStream, ${decision}, this.context)`;
	const replacement = [
		'            while (this.tokenStream.LA(1) === PlSqlParser.LEFT_PAREN) {',
		'                alternative = this.numberOfSyntaxErrors === 0',
		'                    ? (this.tokenStream.LA(2) === PlSqlParser.PLUS_SIGN && this.tokenStream.LA(3) === PlSqlParser.RIGHT_PAREN',
		'                        ? 2',
		'                        : this.tokenStream.LA(2) === PlSqlParser.TREAT',
		`                            ? ${prediction}`,
		'                            : 1)',
		`                    : ${prediction};`,
		'                if (alternative !== 1) {',
		'                    break;',
		'                }',
		`                this.state = ${argumentState};`,
		'                this.function_argument();',
		'            }',
	].join('\n');

	return source.replace(GENERAL_ELEMENT_PART_ARGUMENT_LOOP, `${matchedPrefix}${replacement}${suffix}`);
};

const ROUTINE_NAME_LOOP =
	/(?<prefix>    public routine_name\(\): Routine_nameContext \{[\s\S]*?)(?<loop>            this\.state = \d+;\n            this\.errorHandler\.sync\(this\);\n            alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\);\n            while \(alternative !== 2 && alternative !== antlr\.ATN\.INVALID_ALT_NUMBER\) \{\n                if \(alternative === 1\) \{\n                    \{\n                    \{\n                    this\.state = (?<periodState>\d+);\n                    this\.match\(PlSqlParser\.PERIOD\);\n                    this\.state = (?<expressionState>\d+);\n                    this\.id_expression\(\);\n                    \}\n                    \}\n                \}\n                this\.state = \d+;\n                this\.errorHandler\.sync\(this\);\n                alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, \d+, this\.context\);\n            \})(?<suffix>[\s\S]*?^    \})/mu;

/**
 * Replaces the dotted-name loop prediction in `routine_name`.
 *
 * The loop is greedy: when `PERIOD` follows the identifier, both continuing and
 * exiting are viable only because a caller may also accept a dotted name. ANTLR
 * resolves that conflict by continuing, so a `PERIOD` check makes the same
 * decision without building an LL prediction context. The check also requires
 * the token after the period to start `id_expression`; without that guard,
 * invalid input such as `name.DETECTED` would consume the period during error
 * recovery instead of leaving it to the caller.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @returns Source with the `routine_name` dotted-name loop predicted by lookahead.
 */
export const optimizeRoutineName = (source: string): string => {
	const match = ROUTINE_NAME_LOOP.exec(source);

	if (match?.groups === undefined) {
		throw new Error('Generated routine_name loop did not match the expected ANTLR shape');
	}
	const decision = match.groups['decision'];
	const expressionState = match.groups['expressionState'];
	const loop = match.groups['loop'];
	const matchedPrefix = match.groups['prefix'];
	const suffix = match.groups['suffix'];

	if (decision === undefined || expressionState === undefined || loop === undefined || matchedPrefix === undefined || suffix === undefined) {
		throw new Error('Generated routine_name loop has incomplete captures');
	}

	// Error recovery must keep the original context-sensitive prediction. Clean
	// input can resolve the loop from the token after the period alone.
	const replacement = [
		'this.numberOfSyntaxErrors === 0',
		`                    ? (this.tokenStream.LA(1) === PlSqlParser.PERIOD`,
		`                        && this.atn.nextTokens(this.atn.states[${expressionState}]!).contains(this.tokenStream.LA(2)) ? 1 : 2)`,
		`                    : this.interpreter.adaptivePredict(this.tokenStream, ${decision}, this.context)`,
	].join('\n');
	const prediction = new RegExp(`this\\.interpreter\\.adaptivePredict\\(this\\.tokenStream, ${decision}, this\\.context\\)`, 'gu');
	const optimizedLoop = loop.replaceAll(prediction, replacement);

	return source.replace(ROUTINE_NAME_LOOP, `${matchedPrefix}${optimizedLoop}${suffix}`);
};

const GENERAL_ELEMENT_METHOD = /(?<prefix>    public general_element\((?:_p\?: number)?\): General_elementContext \{)(?<body>[\s\S]*?)(?<suffix>^    \})/mu;
const GENERAL_ELEMENT_PREDICTION = /this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\)/gu;

/**
 * Skips dotted-part loop prediction in `general_element` when a `PERIOD` cannot follow.
 *
 * The generated rule has an outer left-recursion loop and an inner `+` loop.
 * Both consume `'.' general_element_part`, so their prediction is context
 * sensitive and sometimes needs LL. When the next token is not `PERIOD`, the
 * loop alternative cannot match, so prediction is unnecessary. When it is
 * `PERIOD`, the original prediction still decides whether the loop continues or
 * the caller consumes the period.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @returns Source with both `general_element` loops gated by `PERIOD`.
 */
export const optimizeGeneralElement = (source: string): string => {
	const match = GENERAL_ELEMENT_METHOD.exec(source);

	if (match?.groups === undefined) {
		throw new Error('Generated general_element method did not match the expected ANTLR shape');
	}
	const body = match.groups['body'];
	const matchedPrefix = match.groups['prefix'];
	const suffix = match.groups['suffix'];

	if (body === undefined || matchedPrefix === undefined || suffix === undefined) {
		throw new Error('Generated general_element method has incomplete captures');
	}
	const decisions = [...body.matchAll(GENERAL_ELEMENT_PREDICTION)].map((candidate) => candidate.groups?.['decision']);

	if (decisions.length !== 3 || decisions.some((decision) => decision === undefined)) {
		throw new Error(`Generated general_element method has ${String(decisions.length)} predictions; expected 3`);
	}

	const replacementBody = body.replaceAll(
		GENERAL_ELEMENT_PREDICTION,
		'(this.tokenStream.LA(1) === PlSqlParser.PERIOD ? this.interpreter.adaptivePredict(this.tokenStream, $<decision>, this.context) : 2)',
	);

	return source.replace(GENERAL_ELEMENT_METHOD, `${matchedPrefix}${replacementBody}${suffix}`);
};

const GATED_GENERAL_ELEMENT_PREDICTION =
	/\(this\.tokenStream\.LA\(1\) === PlSqlParser\.PERIOD \? this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\) : 2\)/gu;

const PARSER_CLASS_HEADER = 'export class PlSqlParser extends PlSqlParserBase {';

const LL_PREDICTION_HELPER = `${PARSER_CLASS_HEADER}
    /**
     * Runs one adaptive prediction with full-context (LL) semantics and
     * restores the configured prediction mode.
     */
    private predictWithLl(decision: number): number {
        const interpreter = this.interpreter;
        const mode = interpreter.predictionMode;
        interpreter.predictionMode = 1;

        try {
            return interpreter.adaptivePredict(this.tokenStream, decision, this.context);
        } finally {
            interpreter.predictionMode = mode;
        }
    }
`;

/**
 * Resolves dotted collection-method access with full-context prediction.
 *
 * `DELETE`, `EXTEND`, and `TRIM` are valid `regular_id` tokens, so
 * `general_element` can continue through `'.' DELETE`, `'.' EXTEND`, or
 * `'.' TRIM`. Whether it should continue depends on the caller:
 * `collection_method_call` also accepts that period, so the expression must
 * stop there. SLL cannot see the caller and wrongly continues; LL exits. Use LL
 * prediction only at these rare decisions instead of falling back for the
 * entire file.
 *
 * Requires {@link optimizeGeneralElement} to be applied first.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @returns Source whose collection methods keep LL behavior under SLL parsing.
 */
export const optimizeCollectionMethodCall = (source: string): string => {
	const match = GENERAL_ELEMENT_METHOD.exec(source);

	if (match?.groups === undefined) {
		throw new Error('Generated general_element method did not match the expected ANTLR shape');
	}
	const body = match.groups['body'];
	const matchedPrefix = match.groups['prefix'];
	const suffix = match.groups['suffix'];

	if (body === undefined || matchedPrefix === undefined || suffix === undefined) {
		throw new Error('Generated general_element method has incomplete captures');
	}
	const decisions = [...body.matchAll(GATED_GENERAL_ELEMENT_PREDICTION)].map((candidate) => candidate.groups?.['decision']);

	if (decisions.length !== 3 || decisions.some((decision) => decision === undefined)) {
		throw new Error(
			`Generated general_element method has ${String(decisions.length)} PERIOD-gated predictions; expected 3; run optimizeGeneralElement first`,
		);
	}

	const replacementBody = body.replaceAll(
		GATED_GENERAL_ELEMENT_PREDICTION,
		'(this.tokenStream.LA(1) === PlSqlParser.PERIOD ? (this.tokenStream.LA(2) === PlSqlParser.DELETE || this.tokenStream.LA(2) === PlSqlParser.EXTEND || this.tokenStream.LA(2) === PlSqlParser.TRIM ? this.predictWithLl($<decision>) : this.interpreter.adaptivePredict(this.tokenStream, $<decision>, this.context)) : 2)',
	);

	if (!source.includes(PARSER_CLASS_HEADER)) {
		throw new Error('Generated parser class did not match the expected ANTLR shape');
	}

	return source.replace(PARSER_CLASS_HEADER, LL_PREDICTION_HELPER).replace(GENERAL_ELEMENT_METHOD, `${matchedPrefix}${replacementBody}${suffix}`);
};

const SELECT_LIST_ELEMENTS_METHOD = /(?<prefix>    public select_list_elements\(\): Select_list_elementsContext \{)(?<body>[\s\S]*?)(?<suffix>^    \})/mu;
const SELECT_LIST_ALIAS_PREDICTION =
	/switch \(this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\) \) \{(?:(?!switch)[\s\S])*?this\.column_alias\(\);/u;

/**
 * Skips the select-list alias decision when `BULK COLLECT` follows.
 *
 * In `SELECT expr BULK COLLECT INTO ...`, `BULK` is also a valid alias. SLL
 * consumes it as an alias and then fails at `COLLECT`; LL sees that only
 * `into_clause` can consume the following `COLLECT`, so it parses no alias.
 * The two-token guard resolves the same decision without prediction.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @returns Source whose select-list alias prediction defers to `BULK COLLECT`.
 */
export const optimizeBulkCollectAlias = (source: string): string => {
	const match = SELECT_LIST_ELEMENTS_METHOD.exec(source);

	if (match?.groups === undefined) {
		throw new Error('Generated select_list_elements method did not match the expected ANTLR shape');
	}
	const body = match.groups['body'];
	const matchedPrefix = match.groups['prefix'];
	const suffix = match.groups['suffix'];

	if (body === undefined || matchedPrefix === undefined || suffix === undefined) {
		throw new Error('Generated select_list_elements method has incomplete captures');
	}
	const alias = SELECT_LIST_ALIAS_PREDICTION.exec(body);
	const decision = alias?.groups?.['decision'];

	if (decision === undefined) {
		throw new Error('Generated select_list_elements method has no column_alias prediction');
	}
	const prediction = `this.interpreter.adaptivePredict(this.tokenStream, ${decision}, this.context)`;

	if (body.split(prediction).length !== 2) {
		throw new Error(`Generated select_list_elements method has an unexpected number of decision ${decision} predictions`);
	}

	const replacementBody = body.replace(
		prediction,
		`(this.tokenStream.LA(1) === PlSqlParser.BULK && this.tokenStream.LA(2) === PlSqlParser.COLLECT ? 2 : ${prediction})`,
	);

	return source.replace(SELECT_LIST_ELEMENTS_METHOD, `${matchedPrefix}${replacementBody}${suffix}`);
};

/** Generated-parser optimizations that experiments may enable independently. */
export type GeneratedParserOptimization =
	| 'bulkCollectAlias'
	| 'collectionMethodCall'
	| 'generalElement'
	| 'generalElementPart'
	| 'generalElementPartPrediction'
	| 'routineName';

/** Every generated-parser optimization, in the order required by its transforms. */
export const GENERATED_PARSER_OPTIMIZATIONS: readonly GeneratedParserOptimization[] = [
	'generalElement',
	'collectionMethodCall',
	'generalElementPart',
	'generalElementPartPrediction',
	'bulkCollectAlias',
	'routineName',
];

const OPTIMIZERS: Readonly<Record<GeneratedParserOptimization, (source: string) => string>> = {
	bulkCollectAlias: optimizeBulkCollectAlias,
	collectionMethodCall: optimizeCollectionMethodCall,
	generalElement: optimizeGeneralElement,
	generalElementPart: optimizeGeneralElementPart,
	generalElementPartPrediction: optimizeGeneralElementPartPrediction,
	routineName: optimizeRoutineName,
};

/**
 * Applies selected generated-parser optimizations in their required order.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @param optimizations - Optimizations to apply; declaration order is irrelevant.
 * @returns Optimized generated parser source.
 */
export const optimizeGeneratedParser = (source: string, optimizations: readonly GeneratedParserOptimization[]): string =>
	GENERATED_PARSER_OPTIMIZATIONS.filter((optimization) => optimizations.includes(optimization)).reduce(
		(optimized, optimization) => OPTIMIZERS[optimization](optimized),
		source,
	);
