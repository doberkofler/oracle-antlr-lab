const GENERAL_ELEMENT_PART_METHOD =
	/(?<prefix>    public general_element_part\(\): General_element_partContext \{[\s\S]*?)(?<loop>            this\.state = \d+;\n            this\.errorHandler\.sync\(this\);\n            alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, (?<decision>\d+), this\.context\);\n            while \(alternative !== 2 && alternative !== antlr\.ATN\.INVALID_ALT_NUMBER\) \{\n                if \(alternative === 1\) \{\n                    \{\n                    \{\n                    this\.state = (?<argumentState>\d+);\n                    this\.function_argument\(\);\n                    \}\n                    \}\n                \}\n                this\.state = \d+;\n                this\.errorHandler\.sync\(this\);\n                alternative = this\.interpreter\.adaptivePredict\(this\.tokenStream, \d+, this\.context\);\n            \})(?<suffix>[\s\S]*?^    \})/mu;

/** Skips context-sensitive argument-loop prediction when its consuming alternative cannot match. */
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
