import { defineConfig } from 'oxlint';

export default defineConfig({
	plugins: ['typescript', 'unicorn', 'oxc'],
	env: { node: true },
	ignorePatterns: [
		'grammar/typescript/generated/**',
		'grammar/upstream/**',
		'grammar/adapted/**',
		'grammar/typescript/plSqlLexerBase.ts',
		'grammar/typescript/plSqlParserBase.ts',
		'.work/**',
		'results/**',
	],
	rules: {
		'no-console': 'off',
		'typescript/no-explicit-any': 'error',
		'typescript/no-non-null-assertion': 'error',
		'no-var': 'error',
		eqeqeq: ['error', 'always'],
		radix: 'error',
		'prefer-const': 'warn',
		'no-eval': 'error',
		'no-implied-eval': 'error',
		'no-new-func': 'error',
		'no-extend-native': 'error',
		'no-shadow': 'error',
		'no-array-constructor': 'error',
		'no-throw-literal': 'error',
	},
});
