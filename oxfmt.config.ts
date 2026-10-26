// Plain object: Oxfmt's config loader expects a JSON-serializable default export.
export default {
	useTabs: true,
	semi: true,
	singleQuote: true,
	trailingComma: 'all',
	printWidth: 160,
	ignorePatterns: [
		'grammar/typescript/generated/**',
		'grammar/typescript/plSqlLexerBase.ts',
		'grammar/typescript/plSqlParserBase.ts',
		'grammar/upstream/**',
		'grammar/adapted/**',
		'.work/**',
		'results/**',
		'experiments/**/conformance.md',
		'pnpm-lock.yaml',
	],
};
