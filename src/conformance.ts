import { createHash } from 'node:crypto';

/** Prediction outcomes compared between control and candidate parses. */
export type ConformancePrediction = 'sll' | 'sll-fallback-ll' | 'unknown';

/** One parse observation used by the semantic-conformance oracle. */
export type ConformanceObservation = Readonly<{
	file: string;
	bytes: number;
	sha256: string;
	parseTreeSha256: string;
	unitCount: number;
	accepted: boolean;
	lexerDiagnostics: number;
	parseDiagnostics: number;
	diagnosticsSha256: string;
	tokens: number;
	hiddenTokens: number;
	prediction: ConformancePrediction;
	sllAttempts: number;
	llAttempts: number;
}>;

/** Fields compared for every file. */
export const CONFORMANCE_FIELDS = [
	'parseTreeSha256',
	'unitCount',
	'accepted',
	'lexerDiagnostics',
	'parseDiagnostics',
	'diagnosticsSha256',
	'tokens',
	'hiddenTokens',
	'prediction',
	'sllAttempts',
	'llAttempts',
] as const;

/** One field in the conformance comparison. */
export type ConformanceField = (typeof CONFORMANCE_FIELDS)[number];

/** How one changed file is classified by the oracle. */
export type ConformanceClassification = 'identical' | 'intended' | 'unsupported' | 'defect';

/** Declares which differences are expected and which files are known unsupported syntax. */
export type ConformancePolicy = Readonly<{
	intended?: Readonly<{
		fields: readonly ConformanceField[];
		reason: string;
		/** Returns true only for the exact transition described by `reason`. */
		allows: (control: ConformanceObservation, candidate: ConformanceObservation) => boolean;
	}>;
	/** Differences restricted to named corpus files, identified by SHA-256. */
	intendedFiles?: Readonly<{
		files: readonly string[];
		fields: readonly ConformanceField[];
		reason: string;
		/** Returns true only for the exact transition described by `reason`. */
		allows?: (control: ConformanceObservation, candidate: ConformanceObservation) => boolean;
	}>;
	unsupported?: Readonly<{
		/** SHA-256 identities of files known to be unsupported by both states. */
		files: readonly string[];
		reason: string;
	}>;
}>;

/** One file after comparison. */
export type ConformanceFileResult = Readonly<{
	file: string;
	bytes: number;
	sha256: string;
	classification: ConformanceClassification;
	changedFields: readonly ConformanceField[];
	reason?: string;
	control: ConformanceObservation;
	candidate: ConformanceObservation;
}>;

/** Aggregate result of one control/candidate comparison. */
export type ConformanceComparison = Readonly<{
	status: 'pass' | 'fail';
	comparedFiles: number;
	evidenceSha256: string;
	differences: Readonly<Record<ConformanceField, number>>;
	classifications: Readonly<Record<ConformanceClassification, number>>;
	totals: Readonly<{
		controlAccepted: number;
		candidateAccepted: number;
		controlLexerDiagnostics: number;
		candidateLexerDiagnostics: number;
		controlParseDiagnostics: number;
		candidateParseDiagnostics: number;
		controlFallbackFiles: number;
		candidateFallbackFiles: number;
		controlUnits: number;
		candidateUnits: number;
	}>;
	files: readonly ConformanceFileResult[];
}>;

/**
 * Accepts only the intended transition from a full-file LL fallback to SLL.
 *
 * A fallback removal is legitimate only when the parse tree, accepted units,
 * token counts, and diagnostics are unchanged.
 */
export const FALLBACK_REMOVAL_POLICY: ConformancePolicy = {
	intended: {
		fields: ['prediction', 'sllAttempts', 'llAttempts'],
		reason: 'A file that no longer needs full-file LL fallback reports one SLL attempt and the same parse tree, units, tokens, and diagnostics.',
		allows: (control, candidate) =>
			control.parseTreeSha256 === candidate.parseTreeSha256 &&
			control.unitCount === candidate.unitCount &&
			control.accepted === candidate.accepted &&
			control.lexerDiagnostics === candidate.lexerDiagnostics &&
			control.parseDiagnostics === candidate.parseDiagnostics &&
			control.diagnosticsSha256 === candidate.diagnosticsSha256 &&
			control.tokens === candidate.tokens &&
			control.hiddenTokens === candidate.hiddenTokens &&
			control.prediction === 'sll-fallback-ll' &&
			candidate.prediction === 'sll' &&
			control.sllAttempts === candidate.sllAttempts &&
			control.llAttempts === 1 &&
			candidate.llAttempts === 0,
	},
};

const OPAQUE_IDENTITY = /^source-\d{6}\.[a-z0-9]+$/u;

/**
 * Rejects private file identities that could expose original paths.
 *
 * @param visibility - Corpus visibility recorded in the manifest.
 * @param files - File identities that would be published.
 * @throws Error when a private identity is not opaque.
 */
export const assertOpaqueIdentities = (visibility: 'public' | 'private', files: readonly Readonly<{ path: string }>[]): void => {
	if (visibility === 'public') {
		return;
	}

	for (const file of files) {
		if (!OPAQUE_IDENTITY.test(file.path)) {
			throw new Error(`Private conformance artifact contains a non-opaque identity: ${file.path}`);
		}
	}
};

/**
 * Compares two complete conformance passes.
 *
 * Both inputs must contain the same files in the same order with identical
 * SHA-256 digests. Every changed file is classified as intended, unsupported,
 * or defect. A gate passes only when no file is a defect.
 *
 * @param control - Baseline observations.
 * @param candidate - Candidate observations.
 * @param policy - Expected differences and known unsupported files.
 * @returns Comparison plus per-file evidence.
 * @throws Error when the two passes do not cover the same corpus rows.
 */
export const compareConformance = (
	control: readonly ConformanceObservation[],
	candidate: readonly ConformanceObservation[],
	policy: ConformancePolicy = {},
): ConformanceComparison => {
	if (control.length !== candidate.length) {
		throw new Error(`Conformance passes have ${String(control.length)} control and ${String(candidate.length)} candidate files`);
	}

	const differences = Object.fromEntries(CONFORMANCE_FIELDS.map((field) => [field, 0])) as Record<ConformanceField, number>;
	const classifications: Record<ConformanceClassification, number> = { identical: 0, intended: 0, unsupported: 0, defect: 0 };
	const intendedFields = new Set(policy.intended?.fields ?? []);
	const intendedFileFields = new Set(policy.intendedFiles?.fields ?? []);
	const intendedFiles = new Set(policy.intendedFiles?.files ?? []);
	const unsupportedFiles = new Set(policy.unsupported?.files ?? []);
	const files: ConformanceFileResult[] = [];
	const evidence = createHash('sha256');

	for (const [index, baseline] of control.entries()) {
		const treated = candidate[index];

		if (treated === undefined) {
			throw new Error(`Missing candidate conformance row at ${String(index)}`);
		}

		if (baseline.file !== treated.file || baseline.sha256 !== treated.sha256) {
			throw new Error(`Conformance row ${String(index)} does not identify the same corpus file`);
		}

		const changedFields = CONFORMANCE_FIELDS.filter((field) => baseline[field] !== treated[field]);

		for (const field of changedFields) {
			differences[field] += 1;
		}

		addEvidence(evidence, baseline, treated);
		const classification = classify(baseline, treated, changedFields, intendedFields, intendedFiles, intendedFileFields, unsupportedFiles, policy);

		classifications[classification.kind] += 1;
		files.push({
			file: baseline.file,
			bytes: baseline.bytes,
			sha256: baseline.sha256,
			classification: classification.kind,
			changedFields,
			...(classification.reason === undefined ? {} : { reason: classification.reason }),
			control: baseline,
			candidate: treated,
		});
	}

	const sum = (selector: (file: ConformanceObservation) => number): number => control.reduce((total, file) => total + selector(file), 0);
	const sumCandidate = (selector: (file: ConformanceObservation) => number): number => candidate.reduce((total, file) => total + selector(file), 0);

	return {
		status: classifications.defect === 0 ? 'pass' : 'fail',
		comparedFiles: files.length,
		evidenceSha256: evidence.digest('hex'),
		differences,
		classifications,
		totals: {
			controlAccepted: control.filter((file) => file.accepted).length,
			candidateAccepted: candidate.filter((file) => file.accepted).length,
			controlLexerDiagnostics: sum((file) => file.lexerDiagnostics),
			candidateLexerDiagnostics: sumCandidate((file) => file.lexerDiagnostics),
			controlParseDiagnostics: sum((file) => file.parseDiagnostics),
			candidateParseDiagnostics: sumCandidate((file) => file.parseDiagnostics),
			controlFallbackFiles: control.filter((file) => file.llAttempts > 0).length,
			candidateFallbackFiles: candidate.filter((file) => file.llAttempts > 0).length,
			controlUnits: sum((file) => file.unitCount),
			candidateUnits: sumCandidate((file) => file.unitCount),
		},
		files,
	};
};

const classify = (
	control: ConformanceObservation,
	candidate: ConformanceObservation,
	changedFields: readonly ConformanceField[],
	intendedFields: ReadonlySet<ConformanceField>,
	intendedFiles: ReadonlySet<string>,
	intendedFileFields: ReadonlySet<ConformanceField>,
	unsupportedFiles: ReadonlySet<string>,
	policy: ConformancePolicy,
): Readonly<{ kind: ConformanceClassification; reason?: string }> => {
	if (changedFields.length === 0) {
		return { kind: 'identical' };
	}

	if (unsupportedFiles.has(control.sha256) && !control.accepted && !candidate.accepted) {
		return { kind: 'unsupported', reason: policy.unsupported?.reason ?? 'Known unsupported syntax' };
	}

	if (policy.intended !== undefined && changedFields.every((field) => intendedFields.has(field)) && policy.intended.allows(control, candidate)) {
		return { kind: 'intended', reason: policy.intended.reason };
	}

	if (
		policy.intendedFiles !== undefined &&
		intendedFiles.has(control.sha256) &&
		changedFields.every((field) => intendedFileFields.has(field)) &&
		(policy.intendedFiles.allows?.(control, candidate) ?? true)
	) {
		return { kind: 'intended', reason: policy.intendedFiles.reason };
	}

	return { kind: 'defect', reason: 'Unexplained difference in a required conformance field' };
};

const addEvidence = (digest: ReturnType<typeof createHash>, control: ConformanceObservation, candidate: ConformanceObservation): void => {
	digest.update(control.file);
	digest.update('\u0000');
	digest.update(control.sha256);
	digest.update('\u0000');

	for (const field of CONFORMANCE_FIELDS) {
		digest.update(field);
		digest.update('\u0001');
		digest.update(String(control[field]));
		digest.update('\u0001');
		digest.update(String(candidate[field]));
		digest.update('\u0000');
	}
};
