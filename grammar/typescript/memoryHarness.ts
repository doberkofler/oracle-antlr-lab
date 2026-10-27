import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import path from 'node:path';
import { type MemoryCheckpoint, type MemoryEvidence, type MemoryPassBody, summarizeAllocationProfile } from '../../src/memory.ts';
import { clearDfaAtBoundary, parseDfaCachePolicy } from './dfaCache.ts';
import { evictDfaAtBoundary, parseSelectiveDfaSchedule } from './dfaEviction.ts';
import { type FileEntry, parseSource } from './parse.ts';

type Manifest = Readonly<{ files: readonly FileEntry[] }>;

const root = path.resolve(import.meta.dirname, '..', '..');
const manifestPath = process.env['LAB_MANIFEST'];
const filesDir = process.env['LAB_FILES'];

if (manifestPath === undefined || filesDir === undefined) {
	throw new Error('LAB_MANIFEST and LAB_FILES are required');
}

const garbageCollect = globalThis.gc;

if (typeof garbageCollect !== 'function') {
	throw new Error('The memory harness requires node --expose-gc');
}

const sourcesDir = filesDir;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const selectedIds = process.env['LAB_IDS']?.split(',').map(Number).filter(Number.isInteger);
const selected = selectedIds === undefined ? manifest.files : manifest.files.filter((file) => selectedIds.includes(file.id));

if (selected.length === 0) {
	throw new Error('Memory harness received an empty selection');
}

const gcEvery = positiveInteger(process.env['LAB_GC_EVERY'] ?? '25');
const samplingInterval = positiveInteger(process.env['LAB_SAMPLING_INTERVAL'] ?? '32768');
const treeIndex = process.env['LAB_TREE_INDEX'] === undefined ? undefined : Number(process.env['LAB_TREE_INDEX']);
const allocationProfilePath = process.env['LAB_ALLOCATION_PROFILE'];
const dfaCachePolicy = parseDfaCachePolicy(process.env['LAB_DFA_CLEAR_EVERY'], process.env['LAB_DFA_MAX_HEAP_MIB']);
const selectiveDfaSchedule = parseSelectiveDfaSchedule(
	process.env['LAB_DFA_SELECTIVE_EVERY'],
	process.env['LAB_DFA_SELECTIVE_HEAP_MIB'],
	process.env['LAB_DFA_HOT_MAX_STATES'],
	process.env['LAB_DFA_COLD_MAX_STATES'],
	process.env['LAB_DFA_TOTAL_MAX_STATES'],
	process.env['LAB_DFA_HOT_DECISIONS'],
);
const evidence: MemoryEvidence[] = [];

const measure = (): Readonly<{ heapUsedBytes: number; rssBytes: number; heapTotalBytes: number }> => {
	garbageCollect();
	garbageCollect();
	const usage = process.memoryUsage();
	return { heapUsedBytes: usage.heapUsed, rssBytes: usage.rss, heapTotalBytes: usage.heapTotal };
};

const startup = measure();
const session = allocationProfilePath === undefined ? null : new Session();

if (session !== null) {
	session.connect();
	await session.post('HeapProfiler.enable');
	await session.post('HeapProfiler.startSampling', { samplingInterval });
}

const startedAt = performance.now();
let coreMs = 0;
let peakHeapUsedBytes = 0;
let lastParser: ReturnType<typeof parseSource>['parser'] | null = null;
const checkpoints: MemoryCheckpoint[] = [];

for (const [position, entry] of selected.entries()) {
	const processed = processEntry(entry);
	coreMs += processed.observation.coreMs;
	lastParser = processed.parser;
	clearDfaAtBoundary(processed.parser, position + 1, dfaCachePolicy);
	evictDfaAtBoundary(processed.parser, position + 1, selectiveDfaSchedule);
	const heapUsedBytes = process.memoryUsage().heapUsed;
	peakHeapUsedBytes = Math.max(peakHeapUsedBytes, heapUsedBytes);
	const checkpoint = position + 1 === selected.length || (position + 1) % gcEvery === 0;
	checkpoints.push({
		file: entry.path,
		position: position + 1,
		coreMs: processed.observation.coreMs,
		heapUsedBytes,
		retainedHeapBytes: checkpoint ? measure().heapUsedBytes : null,
		rssBytes: process.resourceUsage().maxRSS * 1024,
		dfaStates: dfaStates(processed.parser),
		allocatedBytes: null,
	});

	if (position + 1 === selected.length || (position + 1) % 10 === 0) {
		process.stderr.write(`[${String(position + 1)}/${String(selected.length)}] elapsed ${formatDuration(performance.now() - startedAt)}\n`);
	}
}

const elapsedMs = performance.now() - startedAt;
const peakRssBytes = process.resourceUsage().maxRSS * 1024;
let allocation = null;

if (session !== null) {
	const finished = await finishAllocation(session, allocationProfilePath, samplingInterval);
	allocation = finished.summary;
	evidence.push(...finished.evidence);
}

const retainedEnd = measure();
const dfaDecisions = lastParser?.interpreter?.decisionToDFA.length ?? 0;
const dfaStateCount = lastParser === null ? 0 : dfaStates(lastParser);
const afterCacheClear = clearDfaAndMeasure(lastParser);
const dfaRetainedBytes = Math.max(0, retainedEnd.heapUsedBytes - afterCacheClear.heapUsedBytes);
lastParser = null;
const afterParserDrop = measure();

let retention = null;

if (selected.length > 0) {
	const entry = selected.find((file) => file.id === treeIndex) ?? selected.at(-1);

	if (entry !== undefined) {
		retention = measureRetention(entry);
	}
}

const result: MemoryPassBody = {
	files: selected.length,
	coreMs,
	elapsedMs,
	startupHeapBytes: startup.heapUsedBytes,
	retainedEndBytes: retainedEnd.heapUsedBytes,
	afterCacheClearBytes: afterCacheClear.heapUsedBytes,
	afterParserDropBytes: afterParserDrop.heapUsedBytes,
	peakRssBytes,
	peakHeapUsedBytes,
	dfa: { decisions: dfaDecisions, states: dfaStateCount, retainedBytes: dfaRetainedBytes },
	retention,
	representativeHeap: null,
	allocation,
	heap: null,
	checkpoints,
	evidence,
};

process.stdout.write(`${JSON.stringify(result)}\n`);

function processEntry(
	entry: FileEntry,
): Readonly<{ observation: ReturnType<typeof parseSource>['observation']; parser: ReturnType<typeof parseSource>['parser'] }> {
	const source = readFileSync(path.join(sourcesDir, entry.file), 'utf8');
	const parsed = parseSource(source, entry);
	return { observation: parsed.observation, parser: parsed.parser };
}

function loadRetained(
	entry: FileEntry,
	holder: {
		tree?: ReturnType<typeof parseSource>['tree'] | undefined;
		stream?: ReturnType<typeof parseSource>['stream'] | undefined;
		source?: string | undefined;
	},
): number {
	const source = readFileSync(path.join(sourcesDir, entry.file), 'utf8');
	const parsed = parseSource(source, entry);
	holder.tree = parsed.tree;
	holder.stream = parsed.stream;
	holder.source = parsed.source;
	return parsed.observation.tokens;
}

function measureRetention(entry: FileEntry): MemoryPassBody['retention'] {
	const retained: {
		tree?: ReturnType<typeof parseSource>['tree'] | undefined;
		stream?: ReturnType<typeof parseSource>['stream'] | undefined;
		source?: string | undefined;
	} = {};
	let tokens = 0;

	tokens = loadRetained(entry, retained);

	const withTreeBytes = measure().heapUsedBytes;

	retained.tree = undefined;
	const withoutTreeBytes = measure().heapUsedBytes;
	retained.source = undefined;
	const withoutSourceBytes = measure().heapUsedBytes;
	retained.stream = undefined;
	const withoutStreamBytes = measure().heapUsedBytes;

	return {
		file: entry.path,
		tokens,
		withTreeBytes,
		withoutTreeBytes,
		withoutSourceBytes,
		withoutStreamBytes,
		treeBytes: Math.max(0, withTreeBytes - withoutTreeBytes),
		sourceBytes: Math.max(0, withoutTreeBytes - withoutSourceBytes),
		tokenBytes: Math.max(0, withoutSourceBytes - withoutStreamBytes),
	};
}

async function finishAllocation(
	inspectorSession: Session,
	profilePath: string | undefined,
	interval: number,
): Promise<Readonly<{ summary: NonNullable<MemoryPassBody['allocation']>; evidence: readonly MemoryEvidence[] }>> {
	const { profile } = await new Promise<{ profile: Parameters<typeof summarizeAllocationProfile>[0] }>((resolve, reject) => {
		inspectorSession.post('HeapProfiler.stopSampling', (error, value) => {
			if (error === null) {
				resolve(value);
			} else {
				reject(error);
			}
		});
	});
	const evidenceItems: MemoryEvidence[] = [];

	if (profilePath !== undefined) {
		const text = JSON.stringify(profile);
		writeFileSync(profilePath, text);
		evidenceItems.push({ name: path.basename(profilePath), bytes: Buffer.byteLength(text), sha256: digest(text) });
	}

	const summary = { ...summarizeAllocationProfile(profile, root), samplingIntervalBytes: interval };
	inspectorSession.disconnect();
	return { summary, evidence: evidenceItems };
}

function clearDfaAndMeasure(parser: ReturnType<typeof parseSource>['parser'] | null) {
	const interpreter = parser?.interpreter ?? null;

	if (interpreter === null) {
		return measure();
	}

	interpreter.clearDFA();
	return measure();
}

function dfaStates(parser: ReturnType<typeof parseSource>['parser']): number {
	return parser.interpreter?.decisionToDFA.reduce((total, dfa) => total + dfa.length, 0) ?? 0;
}

function positiveInteger(value: string): number {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`Expected a positive integer, received ${value}`);
	}

	return parsed;
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1_000));
	return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
}
