import { describe, expect, it } from 'vitest';

import { assertOpaqueIdentities, compareConformance, type ConformanceObservation, FALLBACK_REMOVAL_POLICY } from '../src/conformance.ts';
import { CONFORMANCE_CHANGE_SETS } from '../src/conformanceChanges.ts';

const observation = (overrides: Partial<ConformanceObservation> = {}): ConformanceObservation => ({
	file: 'source-000001.pkb',
	bytes: 1024,
	sha256: 'a'.repeat(64),
	parseTreeSha256: 'b'.repeat(64),
	unitCount: 2,
	accepted: true,
	lexerDiagnostics: 0,
	parseDiagnostics: 0,
	diagnosticsSha256: 'c'.repeat(64),
	tokens: 100,
	hiddenTokens: 20,
	prediction: 'sll',
	sllAttempts: 1,
	llAttempts: 0,
	...overrides,
});

describe('compareConformance', () => {
	it('passes identical passes with no differences', () => {
		const result = compareConformance([observation()], [observation()]);

		expect(result.status).toBe('pass');
		expect(result.comparedFiles).toBe(1);
		expect(result.classifications).toEqual({ identical: 1, intended: 0, unsupported: 0, defect: 0 });
		expect(Object.values(result.differences).every((count) => count === 0)).toBe(true);
		expect(result.evidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
	});

	it('classifies the declared fallback removal as intended', () => {
		const control = observation({ prediction: 'sll-fallback-ll', llAttempts: 1 });
		const candidate = observation();
		const result = compareConformance([control], [candidate], FALLBACK_REMOVAL_POLICY);

		expect(result.status).toBe('pass');
		expect(result.classifications.intended).toBe(1);
		expect(result.differences.prediction).toBe(1);
		expect(result.differences.llAttempts).toBe(1);
		expect(result.totals.controlFallbackFiles).toBe(1);
		expect(result.totals.candidateFallbackFiles).toBe(0);
	});

	it('rejects an introduced fallback', () => {
		const control = observation();
		const candidate = observation({ prediction: 'sll-fallback-ll', llAttempts: 1 });
		const result = compareConformance([control], [candidate], FALLBACK_REMOVAL_POLICY);

		expect(result.status).toBe('fail');
		expect(result.classifications.defect).toBe(1);
	});

	it('rejects a fallback removal that changes the parse tree', () => {
		const control = observation({ prediction: 'sll-fallback-ll', llAttempts: 1 });
		const candidate = observation({ parseTreeSha256: 'd'.repeat(64) });
		const result = compareConformance([control], [candidate], FALLBACK_REMOVAL_POLICY);

		expect(result.status).toBe('fail');
		expect(result.classifications.defect).toBe(1);
	});

	it('rejects a diagnostic message change with an unchanged count', () => {
		const control = observation({ accepted: false, parseDiagnostics: 1 });
		const candidate = observation({ accepted: false, parseDiagnostics: 1, diagnosticsSha256: 'e'.repeat(64) });
		const result = compareConformance([control], [candidate]);

		expect(result.status).toBe('fail');
		expect(result.differences.diagnosticsSha256).toBe(1);
		expect(result.classifications.defect).toBe(1);
	});

	it('rejects token and accepted-unit changes', () => {
		const result = compareConformance(
			[observation({ file: 'source-000001.pkb', sha256: 'a'.repeat(64) }), observation({ file: 'source-000002.pkb', sha256: 'b'.repeat(64) })],
			[
				observation({ file: 'source-000001.pkb', sha256: 'a'.repeat(64), tokens: 101 }),
				observation({ file: 'source-000002.pkb', sha256: 'b'.repeat(64), unitCount: 3 }),
			],
		);

		expect(result.status).toBe('fail');
		expect(result.differences.tokens).toBe(1);
		expect(result.differences.unitCount).toBe(1);
		expect(result.classifications.defect).toBe(2);
	});

	it('classifies an allowlisted unsupported file only while both states reject it', () => {
		const control = observation({ accepted: false, parseDiagnostics: 2 });
		const candidate = observation({ accepted: false, parseDiagnostics: 2, parseTreeSha256: 'f'.repeat(64) });
		const policy = { unsupported: { files: [control.sha256], reason: 'Known unsupported syntax' } } as const;

		expect(compareConformance([control], [candidate], policy).classifications.unsupported).toBe(1);
		expect(compareConformance([control], [observation({ parseTreeSha256: 'f'.repeat(64) })], policy).classifications.defect).toBe(1);
	});

	it('rejects passes that do not cover the same corpus rows', () => {
		expect(() => compareConformance([observation()], [])).toThrow(/control and 0 candidate/u);
		expect(() => compareConformance([observation()], [observation({ file: 'source-000002.pkb', sha256: 'b'.repeat(64) })])).toThrow(/same corpus file/u);
	});
});

describe('assertOpaqueIdentities', () => {
	it('allows opaque private identities', () => {
		expect(() => assertOpaqueIdentities('private', [{ path: 'source-001234.pkb' }])).not.toThrow();
	});

	it('rejects a private path or object identity', () => {
		expect(() => assertOpaqueIdentities('private', [{ path: 'pkg/orders.pkb' }])).toThrow(/non-opaque/u);
		expect(() => assertOpaqueIdentities('private', [{ path: 'source-001234_order_pkg.pkb' }])).toThrow(/non-opaque/u);
	});
});

describe('conformance change sets', () => {
	it('gates issues #1–#3 and the combined final state', () => {
		expect(CONFORMANCE_CHANGE_SETS.map((change) => change.issue)).toEqual([1, 2, 3, 6]);
		expect(CONFORMANCE_CHANGE_SETS[0]?.control).toEqual([]);
		expect(CONFORMANCE_CHANGE_SETS[0]?.candidate).toEqual(['generalElementPart']);
		expect(CONFORMANCE_CHANGE_SETS[1]?.control).toEqual(['generalElementPart']);
		expect(CONFORMANCE_CHANGE_SETS[2]?.candidate).toContain('collectionMethodCall');
		expect(CONFORMANCE_CHANGE_SETS[2]?.candidate).toContain('bulkCollectAlias');
		expect(CONFORMANCE_CHANGE_SETS[3]?.control).toEqual([]);
		expect(CONFORMANCE_CHANGE_SETS.map((change) => change.experiment)).toEqual([
			'005-general-element-part-optimization',
			'006-routine-name-and-general-element',
			'007-full-file-ll-fallback',
			'009-semantic-conformance',
		]);
	});

	it('marks only the fallback-removal change sets as intentionally different', () => {
		expect(CONFORMANCE_CHANGE_SETS.map((change) => change.policy)).toEqual(['none', 'none', 'fallback-removal', 'fallback-removal']);
	});
});
