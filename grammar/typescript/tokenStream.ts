import { CharStream } from 'antlr4ng';
import { prepareConditional } from '../../src/conditional.ts';
import { PlSqlLexer } from './generated/PlSqlLexer.ts';

/** Symbolic token stream without text or source offsets. */
export type LexedTokens = Readonly<{
	types: readonly number[];
	channels: readonly number[];
}>;

/**
 * Lexes source under the same conditional-compilation boundary as `parseSource`.
 *
 * @param source - Oracle source text.
 * @param options - Set `conditional: false` to inspect raw directives.
 * @returns Token types and channels in stream order.
 */
export const tokenizeSource = (source: string, options: Readonly<{ conditional?: boolean }> = {}): LexedTokens => {
	const prepared = options.conditional === false ? source : prepareConditional(source);
	const lexer = new PlSqlLexer(CharStream.fromString(prepared));
	lexer.removeErrorListeners();
	const tokens = lexer.getAllTokens();

	return {
		types: tokens.map((token) => token.type),
		channels: tokens.map((token) => token.channel),
	};
};

/**
 * Resolves a symbolic lexer token name.
 *
 * @param type - Token type, including -1 for end of file.
 * @returns Lexer symbolic name, or a stable fallback for unnamed types.
 */
export const tokenName = (type: number): string => {
	if (type === -1) {
		return 'EOF';
	}

	return PlSqlLexer.symbolicNames[type] ?? `TOKEN_${String(type)}`;
};
