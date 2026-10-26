import {Lexer} from 'antlr4ng';

/**
 * Base for the generated Oracle lexer.
 *
 * The upstream predicate relies on a one-character lookbehind. Keep this
 * implementation byte-for-byte equivalent when changing grammar actions.
 */
export abstract class PlSqlLexerBase extends Lexer {
	public IsNewlineAtPos(pos: number): boolean {
		const la = this.inputStream.LA(pos);
		return la === -1 || String.fromCharCode(la) === '\n';
	}
}
