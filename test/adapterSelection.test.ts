import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { typeScriptAdapter } from '../src/adapters/typescript.ts';
import { loadManifest } from '../src/corpus.ts';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'corpora', 'public', 'manifest.json');
const filesDir = path.join(root, 'corpora', 'public', 'files');

describe('TypeScript adapter selection', () => {
	it('observes only the requested corpus indexes in a shared pass', async () => {
		const { files } = loadManifest(manifestPath, filesDir);
		const first = files[0];
		const last = files.at(-1);

		if (first === undefined || last === undefined) {
			throw new Error('Public corpus requires at least two files');
		}

		const observations = await typeScriptAdapter.runPass?.({
			manifestPath,
			filesDir,
			indexes: [first.id, last.id],
		});

		expect(observations).toBeDefined();
		expect([...(observations?.keys() ?? [])].sort()).toStrictEqual([first.path, last.path].sort());
	});
});
