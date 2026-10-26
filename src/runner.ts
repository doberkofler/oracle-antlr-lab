import { type CorpusFile, type ParseObservation, type ParsedFileRun, type ParserAdapter } from './types.ts';

/**
 * Runs every adapter against one file and records failures without aborting the
 * whole campaign.
 *
 * @param input - File identity, adapter map, and repetition configuration.
 * @returns Runs keyed by adapter name and the failures observed.
 */
export const runFile = async (
	input: Readonly<{
		file: CorpusFile;
		adapters: Readonly<Record<string, ParserAdapter>>;
		manifestPath: string;
		filesDir: string;
		config: Readonly<{ iterations: number; warmups: number; coldRepeats: number }>;
	}>,
): Promise<Readonly<{ runs: Readonly<Record<string, ParsedFileRun>>; failures: readonly Readonly<{ adapter: string; file: string; message: string }>[] }>> => {
	const runs: Record<string, ParsedFileRun> = {};
	const failures: { adapter: string; file: string; message: string }[] = [];

	for (const [adapterName, adapter] of Object.entries(input.adapters)) {
		try {
			const observations = [];

			for (let repeat = 0; repeat < input.config.coldRepeats; repeat += 1) {
				observations.push(
					await adapter.run({
						manifestPath: input.manifestPath,
						filesDir: input.filesDir,
						iterations: input.config.iterations,
						warmups: input.config.warmups,
						index: input.file.id,
					}),
				);
			}

			const first = observations[0];

			if (first === undefined) {
				throw new Error('Adapter returned no observation');
			}

			runs[adapterName] = {
				observedAt: new Date().toISOString(),
				coldSamples: observations.map((observation) => observation.cold),
				cold: medianObservation(observations.map((observation) => observation.cold)),
				warmSamples: observations.map((observation) => observation.warm),
				pass: first.pass,
			};
		} catch (error) {
			failures.push({ adapter: adapterName, file: input.file.path, message: error instanceof Error ? error.message : String(error) });
		}
	}

	return { runs, failures };
};

const medianObservation = (observations: readonly ParseObservation[]): ParseObservation => {
	const sorted = [...observations].sort((left, right) => left.coreMs - right.coreMs);
	const middle = sorted[Math.floor((sorted.length - 1) / 2)];

	if (middle === undefined) {
		throw new Error('Cannot take the median of no observations');
	}

	return middle;
};
