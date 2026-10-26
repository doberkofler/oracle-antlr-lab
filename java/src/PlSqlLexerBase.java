import org.antlr.v4.runtime.CharStream;
import org.antlr.v4.runtime.Lexer;

/**
 * Base class for the generated Java lexer.
 *
 * This is the upstream Java target base, kept local so the Docker build does
 * not fetch source files during image construction.
 */
public abstract class PlSqlLexerBase extends Lexer {
	public PlSqlLexerBase(CharStream input) {
		super(input);
	}

	protected boolean IsNewlineAtPos(int pos) {
		int la = _input.LA(pos);
		return la == -1 || la == '\n';
	}
}
