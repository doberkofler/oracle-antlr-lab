import { readFileSync } from 'node:fs';
import { type ConformanceField, type ConformanceObservation, type ConformancePolicy, CONFORMANCE_FIELDS, FALLBACK_REMOVAL_POLICY } from './conformance.ts';

/** Accepted/rejected outcome declared for a corpus transition. */
export type CorpusOutcome = 'accepted' | 'rejected';

/** A declared corpus acceptance or re-parenting transition. */
export type CorpusTransitionEntry = Readonly<{
	kind: 'acceptance' | 'reparenting';
	file: string;
	sha256: string;
	control: CorpusOutcome;
	candidate: CorpusOutcome;
	reason: string;
}>;

/** A declared corpus file that both grammar states reject. */
export type CorpusUnsupportedEntry = Readonly<{
	file: string;
	sha256: string;
	reason: string;
}>;

/** Declarations for one candidate grammar state. */
export type CorpusPolicyState = Readonly<{
	transitions?: readonly CorpusTransitionEntry[];
	unsupported?: readonly CorpusUnsupportedEntry[];
}>;

/** Checked-in declarations of expected production-corpus differences. */
export type CorpusPolicyFile = Readonly<{
	schemaVersion: 1;
	states: Readonly<Record<string, CorpusPolicyState>>;
}>;

/** Fields that must match for a pure re-parenting difference. */
const REPARENTING_FIELDS: readonly ConformanceField[] = CONFORMANCE_FIELDS.filter((field) => field !== 'parseTreeSha256');

/** Parsed policies, keyed by absolute path. */
const cache = new Map<string, CorpusPolicyFile>();

const isOutcome = (value: unknown): value is CorpusOutcome => value === 'accepted' || value === 'rejected';

/**
 * Reads and validates a corpus-policy file.
 *
 * @param policyPath - Absolute path to the declarations.
 * @returns Validated declarations.
 * @throws Error when the file is malformed.
 */
export const readCorpusPolicy = (policyPath: string): CorpusPolicyFile => {
	const cached = cache.get(policyPath);

	if (cached !== undefined) {
		return cached;
	}

	const policyValue: unknown = JSON.parse(readFileSync(policyPath, 'utf8'));

	if (typeof policyValue !== 'object' || policyValue === null) {
		throw new Error(`${policyPath} must contain a JSON object`);
	}

	const states = Reflect.get(policyValue, 'states');

	if (typeof states !== 'object' || states === null) {
		throw new Error(`${policyPath} requires a states object`);
	}

	const policy: CorpusPolicyFile = { schemaVersion: 1, states: states as Readonly<Record<string, CorpusPolicyState>> };

	for (const [state, value] of Object.entries(policy.states)) {
		for (const entry of value.transitions ?? []) {
			if (
				(entry.kind !== 'acceptance' && entry.kind !== 'reparenting') ||
				typeof entry.file !== 'string' ||
				typeof entry.sha256 !== 'string' ||
				!isOutcome(entry.control) ||
				!isOutcome(entry.candidate) ||
				typeof entry.reason !== 'string'
			) {
				throw new Error(`${policyPath} has an invalid transition for ${state}`);
			}
		}

		for (const entry of value.unsupported ?? []) {
			if (typeof entry.file !== 'string' || typeof entry.sha256 !== 'string' || typeof entry.reason !== 'string') {
				throw new Error(`${policyPath} has an invalid unsupported entry for ${state}`);
			}
		}
	}

	cache.set(policyPath, policy);
	return policy;
};

const outcome = (observation: ConformanceObservation): CorpusOutcome => (observation.accepted ? 'accepted' : 'rejected');

/**
 * Builds the conformance policy for one candidate grammar state.
 *
 * Full-file LL fallback removal is always intended. Declared transitions are
 * restricted to their file identity and direction; declared unsupported files
 * are classified only when both states reject them.
 *
 * @param candidateKey - Grammar state key.
 * @param policyPath - Absolute declarations path, or undefined for no declarations.
 * @returns Conformance policy for the candidate gate.
 */
export const buildCorpusPolicy = (candidateKey: string, policyPath: string | undefined): ConformancePolicy => {
	const state = policyPath === undefined ? undefined : readCorpusPolicy(policyPath).states[candidateKey];
	const transitions = state?.transitions ?? [];
	const unsupported = state?.unsupported ?? [];
	const fallbackPolicy = FALLBACK_REMOVAL_POLICY.intended;

	return {
		...(fallbackPolicy === undefined ? {} : { intended: fallbackPolicy }),
		...(transitions.length === 0
			? {}
			: {
					intendedFiles: {
						files: transitions.map((entry) => entry.sha256),
						fields: CONFORMANCE_FIELDS,
						reason: 'A declared corpus transition for this grammar revision.',
						allows: (controlObservation: ConformanceObservation, candidateObservation: ConformanceObservation) =>
							transitions.some((entry) => {
								if (
									entry.sha256 !== controlObservation.sha256 ||
									outcome(controlObservation) !== entry.control ||
									outcome(candidateObservation) !== entry.candidate
								) {
									return false;
								}

								return (
									entry.kind === 'acceptance' ||
									REPARENTING_FIELDS.every((field) => controlObservation[field] === candidateObservation[field])
								);
							}),
					},
				}),
		...(unsupported.length === 0
			? {}
			: {
					unsupported: {
						files: unsupported.map((entry) => entry.sha256),
						reason: 'Declared corpus file that both grammar states reject; external classification is still required.',
					},
				}),
	};
};
