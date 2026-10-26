import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type FileEntry, type HarnessObservation, parseSource } from './parse.ts';

type Manifest = Readonly<{ files: readonly FileEntry[] }>;

const manifestPath = process.env['LAB_MANIFEST'];
const filesDir = process.env['LAB_FILES'];
const stage = process.env['LAB_STAGE'] ?? 'pass';
const index = process.env['LAB_INDEX'] === undefined ? undefined : Number(process.env['LAB_INDEX']);
const iterations = Number(process.env['LAB_ITERATIONS'] ?? '5');
const warmups = Number(process.env['LAB_WARMUPS'] ?? '1');

if (manifestPath === undefined || filesDir === undefined) {
	throw new Error('LAB_MANIFEST and LAB_FILES are required');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const selectedIds = process.env['LAB_IDS']?.split(',').map(Number).filter(Number.isInteger);
const selected =
	index === undefined
		? selectedIds === undefined
			? manifest.files
			: manifest.files.filter((file) => selectedIds.includes(file.id))
		: manifest.files.filter((file) => file.id === index);

if (selected.length === 0) {
	throw new Error(`No corpus file at index ${String(index)}`);
}

const median = (values: readonly number[]): number => [...values].sort((left, right) => left - right)[Math.floor((values.length - 1) / 2)] ?? 0;
const merge = (observations: readonly HarnessObservation[]): HarnessObservation => {
	const last = observations.at(-1);

	if (last === undefined) {
		throw new Error('No observations');
	}

	return {
		...last,
		coreMs: median(observations.map((item) => item.coreMs)),
		adapterMs: median(observations.map((item) => item.adapterMs)),
	};
};

const sourceOf = (entry: FileEntry): string => readFileSync(path.join(filesDir, entry.file), 'utf8');
const campaignStartedAt = performance.now();
const results = selected.map((entry, selectedIndex) => {
	const source = sourceOf(entry);
	const finish = (result: Readonly<{ observation: HarnessObservation; samples?: readonly HarnessObservation[] }>) => {
		if (stage === 'pass' && (selectedIndex === 0 || (selectedIndex + 1) % 10 === 0 || selectedIndex + 1 === selected.length)) {
			const completed = selectedIndex + 1;
			const elapsedMs = performance.now() - campaignStartedAt;
			process.stderr.write(`[${String(completed)}/${String(selected.length)}] elapsed ${formatDuration(elapsedMs)}\n`);
		}

		return result;
	};

	if (stage !== 'warm') {
		return finish({ observation: parseSource(source, entry, { treeHash: process.env['LAB_TREE_HASH'] === '1' }).observation });
	}

	for (let warmup = 0; warmup < warmups; warmup += 1) {
		parseSource(source, entry, { treeHash: process.env['LAB_TREE_HASH'] === '1' });
	}

	const samples = Array.from({ length: iterations }, () => parseSource(source, entry, { treeHash: process.env['LAB_TREE_HASH'] === '1' }).observation);
	return finish({ observation: merge(samples), samples });
});

process.stdout.write(`${JSON.stringify({ stage, files: results })}\n`);

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
