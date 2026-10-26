import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.antlr.v4.runtime.BaseErrorListener;
import org.antlr.v4.runtime.CharStreams;
import org.antlr.v4.runtime.CommonTokenStream;
import org.antlr.v4.runtime.RecognitionException;
import org.antlr.v4.runtime.Recognizer;
import org.antlr.v4.runtime.ParserRuleContext;
import org.antlr.v4.runtime.Token;
import org.antlr.v4.runtime.atn.PredictionMode;
import org.antlr.v4.runtime.atn.DecisionInfo;
import org.antlr.v4.runtime.tree.ParseTree;
import org.antlr.v4.runtime.tree.TerminalNode;

/**
 * Standalone Java-target harness.
 *
 * Usage:
 *   Main &lt;source-file&gt; &lt;iterations&gt; &lt;warmups&gt; &lt;cold|warm&gt;
 *   Main pass &lt;source-file&gt;...
 */
public final class Main {
	private static final List<String> PROFILE_RULES = List.of("general_element_part", "routine_name", "general_element");

	private record Observation(double coreMs, double adapterMs, double setupMs, double lexerMs, double sllParseMs, double llParseMs,
			int lexerDiagnostics, int parseDiagnostics, int tokens, int hiddenTokens, String prediction, int sllAttempts, int llAttempts) {
	}

	private record ProfileObservation(String parseTreeSha256, int maxFunctionArgumentsPerPart, int parseDiagnostics) {
	}

	private static final class Errors extends BaseErrorListener {
		int count;

		void clear() {
			count = 0;
		}

		@Override
		public void syntaxError(Recognizer<?, ?> recognizer, Object offendingSymbol, int line, int charPositionInLine, String msg,
				RecognitionException e) {
			count += 1;
		}
	}

	private static final class RuleProfile {
		long timeInPredictionNs;
		long invocations;
		long sllAtnTransitions;
		long sllDfaTransitions;
		long llAtnTransitions;
		long llDfaTransitions;
		long llFallbacks;
		long ambiguities;

		void add(DecisionInfo decision) {
			timeInPredictionNs += decision.timeInPrediction;
			invocations += decision.invocations;
			sllAtnTransitions += decision.SLL_ATNTransitions;
			sllDfaTransitions += decision.SLL_DFATransitions;
			llAtnTransitions += decision.LL_ATNTransitions;
			llDfaTransitions += decision.LL_DFATransitions;
			llFallbacks += decision.LL_Fallback;
			ambiguities += decision.ambiguities.size();
		}
	}

	private Main() {
	}

	private static Observation parse(String source) {
		long started = System.nanoTime();
		long setupStarted = System.nanoTime();
		var lexer = new PlSqlLexer(CharStreams.fromString(source));
		var stream = new CommonTokenStream(lexer);
		double setupMs = (System.nanoTime() - setupStarted) / 1_000_000.0;

		Errors lexerErrors = new Errors();
		lexer.removeErrorListeners();
		lexer.addErrorListener(lexerErrors);
		long lexerStarted = System.nanoTime();
		stream.fill();
		double lexerMs = (System.nanoTime() - lexerStarted) / 1_000_000.0;
		List<Token> allTokens = stream.getTokens();
		int tokenCount = 0;
		for (Token token : allTokens) {
			if (token.getChannel() == Token.DEFAULT_CHANNEL) {
				tokenCount += 1;
			}
		}

		Errors parserErrors = new Errors();
		long parserSetupStarted = System.nanoTime();
		var parser = new PlSqlParser(stream);
		setupMs += (System.nanoTime() - parserSetupStarted) / 1_000_000.0;
		parser.removeErrorListeners();
		parser.addErrorListener(parserErrors);
		parser.getInterpreter().setPredictionMode(PredictionMode.SLL);
		long parserStarted = System.nanoTime();
		parser.sql_script();
		double sllParseMs = (System.nanoTime() - parserStarted) / 1_000_000.0;
		double llParseMs = 0;
		int llAttempts = 0;

		if (parserErrors.count > 0) {
			parserErrors.clear();
			stream.seek(0);
			long llSetupStarted = System.nanoTime();
			parser = new PlSqlParser(stream);
			setupMs += (System.nanoTime() - llSetupStarted) / 1_000_000.0;
			parser.removeErrorListeners();
			parser.addErrorListener(parserErrors);
			parser.getInterpreter().setPredictionMode(PredictionMode.LL);
			long llStarted = System.nanoTime();
			parser.sql_script();
			llParseMs = (System.nanoTime() - llStarted) / 1_000_000.0;
			llAttempts = 1;
		}
		double adapterMs = (System.nanoTime() - started) / 1_000_000.0;

		return new Observation(lexerMs + sllParseMs + llParseMs, adapterMs, setupMs, lexerMs, sllParseMs, llParseMs,
				lexerErrors.count, parserErrors.count, tokenCount, allTokens.size() - tokenCount,
				llAttempts > 0 ? "sll-fallback-ll" : "sll", 1, llAttempts);
	}

	private static double median(List<Double> values) {
		List<Double> sorted = new ArrayList<>(values);
		sorted.sort(Double::compare);
		return sorted.get((sorted.size() - 1) / 2);
	}

	public static void main(String[] args) throws Exception {
		if (args.length < 2) {
			throw new IllegalArgumentException("Usage: Main <file> <iterations> <warmups> <cold|warm> | Main pass <file>...");
		}

		if (args[0].equals("pass")) {
			List<String> files = new ArrayList<>();
			long passStarted = System.nanoTime();
			for (int index = 1; index < args.length; index += 1) {
				String path = args[index];
				Observation observation = parse(Files.readString(Path.of(path)));
				files.add("{\"file\":\"" + escape(path) + "\"," + fields(observation) + "}");
				int completed = index;
				double elapsedSeconds = (System.nanoTime() - passStarted) / 1_000_000_000.0;
				if (completed == 1 || completed % 10 == 0 || completed == args.length - 1) {
					System.err.printf("[%d/%d] elapsed %s%n", completed, args.length - 1, formatDuration(elapsedSeconds));
				}
			}
			System.out.println("{\"files\":[" + String.join(",", files) + "]}");
			return;
		}

		if (args[0].equals("profile")) {
			profileFiles(args);
			return;
		}

		if (args.length < 4) {
			throw new IllegalArgumentException("Usage: Main <file> <iterations> <warmups> <cold|warm>");
		}

		String source = Files.readString(Path.of(args[0]));
		int iterations = Integer.parseInt(args[1]);
		int warmups = Integer.parseInt(args[2]);
		String mode = args[3];

		if (mode.equals("cold")) {
			print(parse(source));
			return;
		}

		for (int index = 0; index < warmups; index += 1) {
			parse(source);
		}

		List<Double> core = new ArrayList<>();
		List<Double> adapter = new ArrayList<>();
		List<Double> setup = new ArrayList<>();
		List<Double> lexer = new ArrayList<>();
		List<Double> sllParse = new ArrayList<>();
		List<Double> llParse = new ArrayList<>();
		Observation last = parse(source);
		for (int index = 0; index < iterations; index += 1) {
			last = parse(source);
			core.add(last.coreMs());
			adapter.add(last.adapterMs());
			setup.add(last.setupMs());
			lexer.add(last.lexerMs());
			sllParse.add(last.sllParseMs());
			llParse.add(last.llParseMs());
		}

		print(new Observation(median(core), median(adapter), median(setup), median(lexer), median(sllParse), median(llParse),
				last.lexerDiagnostics(), last.parseDiagnostics(), last.tokens(), last.hiddenTokens(), last.prediction(), last.sllAttempts(),
				last.llAttempts()));
	}

	private static void profileFiles(String[] args) throws Exception {
		RuleProfile[] totals = new RuleProfile[PROFILE_RULES.size()];
		Map<Integer, RuleProfile> decisionTotals = new TreeMap<>();
		List<String> conformance = new ArrayList<>();
		for (int index = 0; index < totals.length; index += 1) {
			totals[index] = new RuleProfile();
		}
		long started = System.nanoTime();

		for (int index = 1; index < args.length; index += 1) {
			ProfileObservation observation = profile(Files.readString(Path.of(args[index])), totals, decisionTotals);
			conformance.add(String.format(
					"{\"parseTreeSha256\":\"%s\",\"maxFunctionArgumentsPerPart\":%d,\"parseDiagnostics\":%d}",
					observation.parseTreeSha256(), observation.maxFunctionArgumentsPerPart(), observation.parseDiagnostics()));
			int completed = index;
			double elapsedSeconds = (System.nanoTime() - started) / 1_000_000_000.0;
			double remainingSeconds = elapsedSeconds / completed * (args.length - 1 - completed);
			System.err.printf("[%d/%d] elapsed %s, ETA %s%n", completed, args.length - 1, formatDuration(elapsedSeconds),
					formatDuration(remainingSeconds));
		}

		List<String> profiles = new ArrayList<>();
		for (int index = 0; index < totals.length; index += 1) {
			RuleProfile total = totals[index];
			profiles.add(String.format(
					"{\"rule\":\"%s\",\"timeInPredictionNs\":%d,\"invocations\":%d,\"sllAtnTransitions\":%d,\"sllDfaTransitions\":%d,\"llAtnTransitions\":%d,\"llDfaTransitions\":%d,\"llFallbacks\":%d,\"ambiguities\":%d}",
					PROFILE_RULES.get(index), total.timeInPredictionNs, total.invocations, total.sllAtnTransitions,
					total.sllDfaTransitions, total.llAtnTransitions, total.llDfaTransitions, total.llFallbacks, total.ambiguities));
		}
		List<String> decisions = new ArrayList<>();
		for (Map.Entry<Integer, RuleProfile> entry : decisionTotals.entrySet()) {
			int decisionIndex = entry.getKey();
			RuleProfile total = entry.getValue();
			decisions.add(String.format(
					"{\"decision\":%d,\"timeInPredictionNs\":%d,\"invocations\":%d,\"sllAtnTransitions\":%d,\"sllDfaTransitions\":%d,\"llAtnTransitions\":%d,\"llDfaTransitions\":%d,\"llFallbacks\":%d,\"ambiguities\":%d}",
					decisionIndex, total.timeInPredictionNs, total.invocations, total.sllAtnTransitions,
					total.sllDfaTransitions, total.llAtnTransitions, total.llDfaTransitions, total.llFallbacks, total.ambiguities));
		}
		double elapsedMs = (System.nanoTime() - started) / 1_000_000.0;
		System.out.printf(
				"{\"files\":%d,\"elapsedMs\":%.6f,\"profiles\":[%s],\"decisions\":[%s],\"conformance\":[%s]}%n",
				args.length - 1, elapsedMs, String.join(",", profiles), String.join(",", decisions), String.join(",", conformance));
	}

	private static ProfileObservation profile(String source, RuleProfile[] totals, Map<Integer, RuleProfile> decisionTotals)
			throws Exception {
		var lexer = new PlSqlLexer(CharStreams.fromString(source));
		var stream = new CommonTokenStream(lexer);
		stream.fill();
		Errors errors = new Errors();
		var parser = profiledParser(stream, errors, PredictionMode.SLL);
		ParseTree tree = parser.sql_script();
		addProfile(parser, totals, decisionTotals);

		if (errors.count > 0) {
			errors.clear();
			stream.seek(0);
			parser = profiledParser(stream, errors, PredictionMode.LL);
			tree = parser.sql_script();
			addProfile(parser, totals, decisionTotals);
		}

		return new ProfileObservation(parseTreeSha256(tree), maxFunctionArgumentsPerPart(tree), errors.count);
	}

	private static String parseTreeSha256(ParseTree tree) throws Exception {
		MessageDigest digest = MessageDigest.getInstance("SHA-256");
		addTreeToDigest(tree, digest);
		return HexFormat.of().formatHex(digest.digest());
	}

	private static void addTreeToDigest(ParseTree tree, MessageDigest digest) {
		if (tree instanceof ParserRuleContext context) {
			digest.update((byte) 1);
			addIntegerToDigest(context.getRuleIndex(), digest);
			addIntegerToDigest(context.getChildCount(), digest);
		} else if (tree instanceof TerminalNode terminal) {
			digest.update((byte) 2);
			addIntegerToDigest(terminal.getSymbol().getType(), digest);
		} else {
			digest.update((byte) 3);
		}

		for (int index = 0; index < tree.getChildCount(); index += 1) {
			addTreeToDigest(tree.getChild(index), digest);
		}
	}

	private static void addIntegerToDigest(int value, MessageDigest digest) {
		digest.update((byte) (value >>> 24));
		digest.update((byte) (value >>> 16));
		digest.update((byte) (value >>> 8));
		digest.update((byte) value);
	}

	private static int maxFunctionArgumentsPerPart(ParseTree tree) {
		int directArguments = 0;
		int maximum = 0;

		for (int index = 0; index < tree.getChildCount(); index += 1) {
			ParseTree child = tree.getChild(index);
			if (tree instanceof ParserRuleContext context
					&& context.getRuleIndex() == PlSqlParser.RULE_general_element_part
					&& child instanceof ParserRuleContext childContext
					&& childContext.getRuleIndex() == PlSqlParser.RULE_function_argument) {
				directArguments += 1;
			}
			maximum = Math.max(maximum, maxFunctionArgumentsPerPart(child));
		}

		return Math.max(maximum, directArguments);
	}

	private static PlSqlParser profiledParser(CommonTokenStream stream, Errors errors, PredictionMode mode) {
		var parser = new PlSqlParser(stream);
		parser.removeErrorListeners();
		parser.addErrorListener(errors);
		parser.setProfile(true);
		parser.getInterpreter().setPredictionMode(mode);
		return parser;
	}

	private static void addProfile(PlSqlParser parser, RuleProfile[] totals, Map<Integer, RuleProfile> decisionTotals) {
		DecisionInfo[] decisions = parser.getParseInfo().getDecisionInfo();
		for (int decisionIndex = 0; decisionIndex < decisions.length; decisionIndex += 1) {
			int ruleIndex = parser.getATN().decisionToState.get(decisionIndex).ruleIndex;
			String rule = parser.getRuleNames()[ruleIndex];
			int targetIndex = PROFILE_RULES.indexOf(rule);
			if (targetIndex >= 0) {
				totals[targetIndex].add(decisions[decisionIndex]);
				decisionTotals.computeIfAbsent(decisionIndex, ignored -> new RuleProfile()).add(decisions[decisionIndex]);
			}
		}
	}

	private static String escape(String value) {
		return value.replace("\\", "\\\\").replace("\"", "\\\"");
	}

	private static String formatDuration(double seconds) {
		long rounded = Math.max(0, Math.round(seconds));
		return String.format("%dm %02ds", rounded / 60, rounded % 60);
	}

	private static String fields(Observation observation) {
		return String.format(
				"\"coreMs\":%.6f,\"adapterMs\":%.6f,\"phases\":{\"setupMs\":%.6f,\"lexerMs\":%.6f,\"sllParseMs\":%.6f,\"llParseMs\":%.6f},\"lexerDiagnostics\":%d,\"parseDiagnostics\":%d,\"tokens\":%d,\"hiddenTokens\":%d,\"prediction\":\"%s\",\"sllAttempts\":%d,\"llAttempts\":%d,\"peakRssBytes\":%d",
				observation.coreMs(), observation.adapterMs(), observation.setupMs(), observation.lexerMs(), observation.sllParseMs(),
				observation.llParseMs(),
				observation.lexerDiagnostics(), observation.parseDiagnostics(), observation.tokens(), observation.hiddenTokens(),
				observation.prediction(), observation.sllAttempts(), observation.llAttempts(), rssBytes());
	}

	private static long rssBytes() {
		try {
			for (String line : Files.readAllLines(Path.of("/proc/self/status"))) {
				if (line.startsWith("VmHWM:")) {
					String[] parts = line.split("\\s+");
					return Long.parseLong(parts[1]) * 1024L;
				}
			}
		} catch (Exception ignored) {
			// Fall through to the heap estimate when /proc is unavailable.
		}

		return Runtime.getRuntime().totalMemory();
	}

	private static void print(Observation observation) {
		System.out.println("{" + fields(observation) + "}");
	}
}
