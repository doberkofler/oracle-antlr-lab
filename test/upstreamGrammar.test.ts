import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareConformance, CONFORMANCE_FIELDS, type ConformanceObservation } from '../src/conformance.ts';
import { UPSTREAM_GRAMMAR_FIXTURES, UPSTREAM_GRAMMAR_STABLE_FIXTURES } from '../src/upstreamGrammarFixtures.ts';
import { readGrammarStates } from '../scripts/grammarStateSource.ts';
import { buildCorpusPolicy } from '../src/corpusTransitionPolicy.ts';

const root = path.resolve(import.meta.dirname, '..');

const observation = (overrides: Partial<ConformanceObservation> = {}): ConformanceObservation => ({
	file: 'fixture.sql',
	bytes: 64,
	sha256: 'a'.repeat(64),
	parseTreeSha256: 'b'.repeat(64),
	unitCount: 1,
	accepted: false,
	lexerDiagnostics: 0,
	parseDiagnostics: 1,
	diagnosticsSha256: 'c'.repeat(64),
	tokens: 5,
	hiddenTokens: 0,
	prediction: 'sll-fallback-ll',
	sllAttempts: 1,
	llAttempts: 1,
	...overrides,
});

describe('upstream grammar states', () => {
	it('declares unique states with a complete merge chain', () => {
		const manifest = readGrammarStates(root);
		const keys = new Set(manifest.states.map((state) => state.key));

		expect(keys.size).toBe(manifest.states.length);
		expect(keys.has('control')).toBe(true);

		for (const state of manifest.states) {
			if (state.ref === undefined && state.merge === undefined) {
				throw new Error(`State ${state.key} has neither ref nor merge`);
			}

			for (const merged of state.merge ?? []) {
				expect(keys.has(merged)).toBe(true);
			}
		}
	});

	it('records a digest lock for every declared state', () => {
		const manifest = readGrammarStates(root);
		const lock: unknown = JSON.parse(readFileSync(path.join(root, 'grammar', 'states.lock.json'), 'utf8'));
		const states = Reflect.get(lock as object, 'states');

		expect(typeof states).toBe('object');

		for (const state of manifest.states) {
			expect(states).toHaveProperty(state.key);
		}
	});

	it('keeps every declared fixture in the public fixture corpus', () => {
		const fixtureManifest: unknown = JSON.parse(readFileSync(path.join(root, 'corpora', 'upstream-prs', 'manifest.json'), 'utf8'));
		const files = Reflect.get(fixtureManifest as object, 'files');

		expect(Array.isArray(files)).toBe(true);
		const names = new Set((files as readonly Readonly<{ file: string }>[]).map((file) => file.file));

		for (const expectation of [...UPSTREAM_GRAMMAR_FIXTURES, ...UPSTREAM_GRAMMAR_STABLE_FIXTURES]) {
			expect(names.has(expectation.file)).toBe(true);
		}
	});

	it('references declared states from every fixture expectation', () => {
		const manifest = readGrammarStates(root);
		const keys = new Set(manifest.states.map((state) => state.key));

		for (const expectation of [...UPSTREAM_GRAMMAR_FIXTURES, ...UPSTREAM_GRAMMAR_STABLE_FIXTURES]) {
			expect(keys.has(expectation.state)).toBe(true);
		}
	});
});

describe('intendedFiles conformance policy', () => {
	const policy = {
		intendedFiles: {
			files: ['a'.repeat(64)],
			fields: CONFORMANCE_FIELDS,
			reason: 'declared fixture transition',
			allows: (control: ConformanceObservation, candidate: ConformanceObservation) => !control.accepted && candidate.accepted,
		},
	};

	it('accepts the declared transition on the declared file', () => {
		const result = compareConformance([observation()], [observation({ accepted: true, parseDiagnostics: 0 })], policy);

		expect(result.status).toBe('pass');
		expect(result.classifications.intended).toBe(1);
	});

	it('rejects the transition on another file', () => {
		const result = compareConformance(
			[observation({ sha256: 'd'.repeat(64) })],
			[observation({ sha256: 'd'.repeat(64), accepted: true, parseDiagnostics: 0 })],
			policy,
		);

		expect(result.status).toBe('fail');
		expect(result.classifications.defect).toBe(1);
	});

	it('rejects an undeclared transition direction on the declared file', () => {
		const result = compareConformance([observation({ accepted: true, parseDiagnostics: 0 })], [observation()], policy);

		expect(result.status).toBe('fail');
		expect(result.classifications.defect).toBe(1);
	});
});

describe('corpus transition policy', () => {
	it('classifies only the declared acceptance, re-parenting, unsupported, and fallback transitions', () => {
		const directory = mkdtempSync(path.join('node_modules', '.cache-policy-'));

		try {
			const policyPath = path.join(directory, 'corpus-policy.json');
			writeFileSync(
				policyPath,
				JSON.stringify({
					schemaVersion: 1,
					states: {
						candidate: {
							transitions: [
								{
									kind: 'acceptance',
									file: 'accepted.sql',
									sha256: 'a'.repeat(64),
									control: 'rejected',
									candidate: 'accepted',
									reason: 'test acceptance',
								},
								{
									kind: 'reparenting',
									file: 'reparented.sql',
									sha256: 'b'.repeat(64),
									control: 'accepted',
									candidate: 'accepted',
									reason: 'test re-parenting',
								},
							],
							unsupported: [{ file: 'unsupported.sql', sha256: 'c'.repeat(64), reason: 'test unsupported' }],
						},
					},
				}),
			);
			const policy = buildCorpusPolicy('candidate', policyPath);

			expect(
				compareConformance(
					[observation({ sha256: 'a'.repeat(64) })],
					[observation({ sha256: 'a'.repeat(64), accepted: true, parseDiagnostics: 0 })],
					policy,
				).classifications.intended,
			).toBe(1);
			expect(
				compareConformance(
					[observation({ sha256: 'b'.repeat(64), accepted: true, parseDiagnostics: 0 })],
					[observation({ sha256: 'b'.repeat(64), accepted: true, parseDiagnostics: 0, parseTreeSha256: 'd'.repeat(64) })],
					policy,
				).classifications.intended,
			).toBe(1);
			expect(
				compareConformance(
					[observation({ sha256: 'b'.repeat(64), accepted: true, parseDiagnostics: 0 })],
					[observation({ sha256: 'b'.repeat(64), accepted: true, parseDiagnostics: 0, parseTreeSha256: 'd'.repeat(64), unitCount: 2 })],
					policy,
				).classifications.defect,
			).toBe(1);
			expect(
				compareConformance(
					[observation({ sha256: 'c'.repeat(64) })],
					[observation({ sha256: 'c'.repeat(64), parseTreeSha256: 'd'.repeat(64) })],
					policy,
				).classifications.unsupported,
			).toBe(1);
			expect(
				compareConformance(
					[observation({ sha256: 'e'.repeat(64), prediction: 'sll-fallback-ll', llAttempts: 1 })],
					[observation({ sha256: 'e'.repeat(64), prediction: 'sll', llAttempts: 0 })],
					policy,
				).classifications.intended,
			).toBe(1);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
