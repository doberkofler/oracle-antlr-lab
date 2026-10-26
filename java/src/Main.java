import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.antlr.v4.runtime.BaseErrorListener;
import org.antlr.v4.runtime.CharStreams;
import org.antlr.v4.runtime.CommonTokenStream;
import org.antlr.v4.runtime.RecognitionException;
import org.antlr.v4.runtime.Recognizer;
import org.antlr.v4.runtime.Token;
import org.antlr.v4.runtime.atn.PredictionMode;

/**
 * Standalone Java-target harness.
 *
 * Usage:
 *   Main &lt;source-file&gt; &lt;iterations&gt; &lt;warmups&gt; &lt;cold|warm&gt;
 *   Main pass &lt;source-file&gt;...
 */
public final class Main {
	private record Observation(double coreMs, double adapterMs, double setupMs, double lexerMs, double parseMs, int lexerDiagnostics,
			int parseDiagnostics, int tokens, int hiddenTokens, String prediction, int sllAttempts, int llAttempts) {
	}

	private static final class Errors extends BaseErrorListener {
		int count;

		@Override
		public void syntaxError(Recognizer<?, ?> recognizer, Object offendingSymbol, int line, int charPositionInLine, String msg,
				RecognitionException e) {
			count += 1;
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
		double parseMs = (System.nanoTime() - parserStarted) / 1_000_000.0;
		double adapterMs = (System.nanoTime() - started) / 1_000_000.0;

		return new Observation(lexerMs + parseMs, adapterMs, setupMs, lexerMs, parseMs, lexerErrors.count, parserErrors.count,
				tokenCount, allTokens.size() - tokenCount, "sll", 1, 0);
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
			for (int index = 1; index < args.length; index += 1) {
				String path = args[index];
				Observation observation = parse(Files.readString(Path.of(path)));
				files.add("{\"file\":\"" + escape(path) + "\"," + fields(observation) + "}");
			}
			System.out.println("{\"files\":[" + String.join(",", files) + "]}");
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
		List<Double> parse = new ArrayList<>();
		Observation last = parse(source);
		for (int index = 0; index < iterations; index += 1) {
			last = parse(source);
			core.add(last.coreMs());
			adapter.add(last.adapterMs());
			setup.add(last.setupMs());
			lexer.add(last.lexerMs());
			parse.add(last.parseMs());
		}

		print(new Observation(median(core), median(adapter), median(setup), median(lexer), median(parse), last.lexerDiagnostics(),
				last.parseDiagnostics(), last.tokens(), last.hiddenTokens(), last.prediction(), last.sllAttempts(), last.llAttempts()));
	}

	private static String escape(String value) {
		return value.replace("\\", "\\\\").replace("\"", "\\\"");
	}

	private static String fields(Observation observation) {
		return String.format(
				"\"coreMs\":%.6f,\"adapterMs\":%.6f,\"phases\":{\"setupMs\":%.6f,\"lexerMs\":%.6f,\"parseMs\":%.6f},\"lexerDiagnostics\":%d,\"parseDiagnostics\":%d,\"tokens\":%d,\"hiddenTokens\":%d,\"prediction\":\"%s\",\"sllAttempts\":%d,\"llAttempts\":%d,\"peakRssBytes\":%d",
				observation.coreMs(), observation.adapterMs(), observation.setupMs(), observation.lexerMs(), observation.parseMs(),
				observation.lexerDiagnostics(), observation.parseDiagnostics(), observation.tokens(), observation.hiddenTokens(),
				observation.prediction(), observation.sllAttempts(), observation.llAttempts(), rssBytes());
	}

	private static long rssBytes() {
		try {
			for (String line : Files.readAllLines(Path.of("/proc/self/status"))) {
				if (line.startsWith("VmRSS:")) {
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
