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

/** Generated-parser optimizations that experiments may enable independently. */
export type GeneratedParserOptimization = 'generalElement' | 'generalElementPart' | 'routineName';

const OPTIMIZERS: Readonly<Record<GeneratedParserOptimization, (source: string) => string>> = {
	generalElement: optimizeGeneralElement,
	generalElementPart: optimizeGeneralElementPart,
	routineName: optimizeRoutineName,
};

/**
 * Applies selected generated-parser optimizations.
 *
 * @param source - Generated `PlSqlParser.ts` source.
 * @param optimizations - Optimizations to apply, in application order.
 * @returns Optimized generated parser source.
 */
export const optimizeGeneratedParser = (source: string, optimizations: readonly GeneratedParserOptimization[]): string =>
	optimizations.reduce((optimized, optimization) => OPTIMIZERS[optimization](optimized), source);
