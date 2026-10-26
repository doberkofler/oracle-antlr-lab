import org.antlr.v4.runtime.Parser;
import org.antlr.v4.runtime.Token;
import org.antlr.v4.runtime.TokenStream;

/**
 * Base class for the generated Java parser.
 *
 * Copied from the pinned upstream Java target and kept local for reproducible
 * builds.
 */
public abstract class PlSqlParserBase extends Parser {
	private boolean _isVersion12 = true;
	private boolean _isVersion11 = true;
	private boolean _isVersion10 = true;
	private boolean _lastUnitWasPlsql = false;

	public PlSqlParserBase(TokenStream input) {
		super(input);
	}

	@Override
	public void reset() {
		_lastUnitWasPlsql = false;
		super.reset();
	}

	public void setLastUnitPlsql() {
		_lastUnitWasPlsql = true;
	}

	public void setLastUnitSql() {
		_lastUnitWasPlsql = false;
	}

	public boolean isLastUnitSql() {
		return !_lastUnitWasPlsql;
	}

	public boolean isLastUnitPlsql() {
		return _lastUnitWasPlsql;
	}

	public boolean isSolidusSeparator() {
		Token solidus = _input.LT(1);
		if (solidus == null || solidus.getType() != PlSqlLexer.SOLIDUS) {
			return false;
		}

		int solidusLine = solidus.getLine();
		Token previous = _input.LT(-1);
		if (previous != null && previous.getType() != Token.EOF && previous.getLine() == solidusLine) {
			return false;
		}

		Token next = _input.LT(2);
		return next == null || next.getType() == Token.EOF || next.getLine() != solidusLine;
	}

	public boolean isVersion10() {
		return _isVersion10;
	}

	public boolean isVersion11() {
		return _isVersion11;
	}

	public boolean isVersion12() {
		return _isVersion12;
	}

	public void setVersion10(boolean value) {
		_isVersion10 = value;
	}

	public void setVersion11(boolean value) {
		_isVersion11 = value;
	}

	public void setVersion12(boolean value) {
		_isVersion12 = value;
	}

	public boolean IsNotNumericFunction() {
		Token lt1 = _input.LT(1);
		Token lt2 = _input.LT(2);
		if (lt1 == null || lt2 == null) {
			return true;
		}

		return !((lt1.getType() == PlSqlLexer.SUM || lt1.getType() == PlSqlLexer.COUNT || lt1.getType() == PlSqlLexer.AVG
				|| lt1.getType() == PlSqlLexer.MIN || lt1.getType() == PlSqlLexer.MAX || lt1.getType() == PlSqlLexer.ROUND
				|| lt1.getType() == PlSqlLexer.LEAST || lt1.getType() == PlSqlLexer.GREATEST) && lt2.getType() == PlSqlLexer.LEFT_PAREN);
	}

	public boolean isNotStartOfJoin() {
		Token lt1 = _input.LT(1);
		if (lt1 == null) {
			return true;
		}

		int type = lt1.getType();
		return !(type == PlSqlLexer.INNER || type == PlSqlLexer.CROSS || type == PlSqlLexer.NATURAL || type == PlSqlLexer.PARTITION
				|| type == PlSqlLexer.FULL || type == PlSqlLexer.LEFT || type == PlSqlLexer.RIGHT || type == PlSqlLexer.OUTER);
	}
}
