import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Grammar source identities and the single local adaptation applied to every
 * upstream revision.
 *
 * The laboratory never edits a downloaded grammar in place. A grammar change is
 * a new upstream revision plus the reviewed adaptations below, so the same
 * adaptation can be applied to the pin, to a control commit, and to any
 * upstream pull-request head.
 */
export const UPSTREAM_REPOSITORY = 'antlr/grammars-v4';

/** Current laboratory pin, used for the committed adapted grammar. */
export const PIN = {
	commit: 'e199816b3f1a7a49ea1ad84fb6b87c382ea36a33',
	lexer: {
		path: 'sql/plsql/PlSqlLexer.g4',
		sha256: 'fd82384ba3ba2f5a7b070a977cd77a05c01fefbfb52938d35dfaf472a2e6e59e',
	},
	parser: {
		path: 'sql/plsql/PlSqlParser.g4',
		sha256: 'c57ec1819302de05beb08c44792883e159254e361e8627e981d9a3c99a0b4633',
	},
	parserBase: {
		path: 'sql/plsql/Antlr4ng/PlSqlParserBase.ts',
		sha256: '240545ca222036231d7044ce468e2c4ed0d1a0ef6df190cb71a717b47faccfcb',
	},
} as const;

/** Upstream files consumed by the TypeScript laboratory. */
export const GRAMMAR_PATHS = {
	lexer: 'sql/plsql/PlSqlLexer.g4',
	parser: 'sql/plsql/PlSqlParser.g4',
	parserBase: 'sql/plsql/Antlr4ng/PlSqlParserBase.ts',
} as const;

/** Immutable upstream and adapted file contents for one grammar state. */
export type GrammarSources = Readonly<{
	lexer: string;
	parser: string;
	parserBase: string;
}>;

/** Adapted grammar plus the generated-recognizer support classes. */
export type AdaptedGrammar = Readonly<{
	lexer: string;
	parser: string;
	lexerBase: string;
	parserBase: string;
}>;

type Patch = Readonly<{ file: 'PlSqlLexer.g4' | 'PlSqlParser.g4'; find: string; replace: string; reason: string }>;

const LEXER_HEADER = `@header {import {PlSqlLexerBase} from "../plSqlLexerBase.js";}

@members {
public isValidAlternativeQuotedString(): boolean {
    const characters = Array.from(this.text);
    const openingDelimiter = characters[2];
    const closingDelimiter = characters.at(-2);
    if (openingDelimiter === undefined || closingDelimiter === undefined || /\\s/u.test(openingDelimiter)) {
        return false;
    }

    switch (openingDelimiter) {
        case '[':
            return closingDelimiter === ']';
        case '{':
            return closingDelimiter === '}';
        case '<':
            return closingDelimiter === '>';
        case '(':
            return closingDelimiter === ')';
        default:
            return closingDelimiter === openingDelimiter;
    }
}
}`;

const patchDirectory = path.resolve(import.meta.dirname, '..', 'grammar', 'patches');

const readPatch = (name: string): string =>
	readFileSync(path.join(patchDirectory, name), 'utf8')
		.replaceAll(String.raw`\/`, '/')
		.trimEnd();

const patches: readonly Patch[] = [
	{
		file: 'PlSqlLexer.g4',
		find: '// Insert here @header for C++ lexer.',
		replace: LEXER_HEADER,
		reason: 'TypeScript lexer base and the alternative-quoted-string predicate.',
	},
	{
		file: 'PlSqlLexer.g4',
		find: readPatch('upstream-q-string.txt'),
		replace: readPatch('adapted-q-string.txt'),
		reason: 'Upstream Q-quote limitation; see grammars-v4#5029 and #5030.',
	},
	{
		file: 'PlSqlParser.g4',
		find: '// Insert here @header for C++ parser.',
		replace: '@header {import {PlSqlParserBase} from "../plSqlParserBase.js";}',
		reason: 'TypeScript parser base import.',
	},
];

/**
 * Upstream merged grammars-v4#5030 and therefore carries the Q-quote predicate
 * in the grammar instead of in the target base class.
 */
const Q_QUOTE_MERGED = /\{this\.IsQQuoteDelimiter\(\)\}\?/u;

/** Applied patches in order, recorded in the grammar manifest. */
export const GRAMMAR_PATCHES: readonly Readonly<{ file: string; reason: string }>[] = patches.map((patch) => ({
	file: patch.file,
	reason: patch.reason,
}));

const applyPatch = (source: string, patch: Patch): string => {
	const first = source.indexOf(patch.find);

	if (first < 0 || first !== source.lastIndexOf(patch.find)) {
		throw new Error(`Patch for ${patch.file} must match exactly once: ${patch.reason}`);
	}

	return source.replace(patch.find, patch.replace);
};

const parserBaseSource = (upstream: string): string => {
	const withLexerImport = upstream.replace("import { PlSqlLexer } from './PlSqlLexer.js';", "import {PlSqlLexer} from './generated/PlSqlLexer.ts';");

	if (withLexerImport === upstream) {
		throw new Error('Parser base lexer import patch did not match');
	}

	return `${withLexerImport
		.replace('  reset(): void {', '  override reset(): void {')
		.replace(
			"import { Parser, TokenStream, CommonTokenStream, Token } from 'antlr4ng';",
			"import {Parser, type TokenStream, CommonTokenStream, Token} from 'antlr4ng';",
		)
		.trimEnd()}\n`;
};

const lexerBaseSource = (qQuoteInGrammar: boolean): string => {
	const qQuoteMethod = qQuoteInGrammar
		? `
	public IsQQuoteDelimiter(): boolean {
		const opening = this.inputStream.LA(this.tokenStartCharIndex + 2 - this.inputStream.index);
		const closing = this.inputStream.LA(-2);

		switch (opening) {
			case 91: // [
				return closing === 93;
			case 123: // {
				return closing === 125;
			case 60: // <
				return closing === 62;
			case 40: // (
				return closing === 41;
			default:
				return closing === opening;
		}
	}
`
		: '';

	return `import {Lexer} from 'antlr4ng';

/**
 * Base for the generated Oracle lexer.
 *
 * The upstream predicate relies on a one-character lookbehind. Keep this
 * implementation byte-for-byte equivalent when changing grammar actions.
 */
export abstract class PlSqlLexerBase extends Lexer {
	public IsNewlineAtPos(pos: number): boolean {
		const la = this.inputStream.LA(pos);
		return la === -1 || String.fromCharCode(la) === '\\n';
	}
${qQuoteMethod}}
`;
};

/**
 * Applies the laboratory's TypeScript adaptations to one upstream revision.
 *
 * The Q-quote adaptation is conditional: grammars before grammars-v4#5030 need
 * the local alternative-quoted-string rule, while merged revisions carry the
 * `IsQQuoteDelimiter` predicate themselves.
 *
 * @param sources - Upstream lexer, parser, and Antlr4ng parser-base contents.
 * @returns Adapted grammar files and the generated-recognizer support classes.
 * @throws Error when an adaptation does not match exactly once.
 */
export const adaptGrammar = (sources: GrammarSources): AdaptedGrammar => {
	let lexer = sources.lexer;
	let parser = sources.parser;
	const qQuoteInGrammar = Q_QUOTE_MERGED.test(sources.lexer);

	for (const patch of patches) {
		if (patch.file === 'PlSqlLexer.g4' && patch.reason.startsWith('Upstream Q-quote') && qQuoteInGrammar) {
			continue;
		}

		if (patch.file === 'PlSqlLexer.g4') {
			lexer = applyPatch(lexer, patch);
		} else {
			parser = applyPatch(parser, patch);
		}
	}

	return {
		lexer,
		parser,
		lexerBase: lexerBaseSource(qQuoteInGrammar),
		parserBase: parserBaseSource(sources.parserBase),
	};
};
