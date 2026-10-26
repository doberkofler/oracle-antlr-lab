import { type GeneratedParserOptimization, GENERATED_PARSER_OPTIMIZATIONS } from './generatedParserOptimization.ts';

/** How the conformance oracle treats differences for one change set. */
export type ConformanceDifferencePolicy = 'none' | 'fallback-removal';

/** One reviewed grammar or parser-recovery change that requires a conformance result. */
export type ConformanceChangeSet = Readonly<{
	id: string;
	issue: number;
	experiment: string;
	title: string;
	control: readonly GeneratedParserOptimization[];
	candidate: readonly GeneratedParserOptimization[];
	policy: ConformanceDifferencePolicy;
}>;

const ALL_OPTIMIZATIONS: readonly GeneratedParserOptimization[] = GENERATED_PARSER_OPTIMIZATIONS;

/** Conformance gates for issues #1–#3 and the combined final state. */
export const CONFORMANCE_CHANGE_SETS: readonly ConformanceChangeSet[] = [
	{
		id: 'issue-1-general-element-part',
		issue: 1,
		experiment: '005-general-element-part-optimization',
		title: 'Guard general_element_part argument-loop prediction',
		control: [],
		candidate: ['generalElementPart'],
		policy: 'none',
	},
	{
		id: 'issue-2-routine-name-and-general-element',
		issue: 2,
		experiment: '006-routine-name-and-general-element',
		title: 'Resolve routine_name with lookahead and gate general_element loops',
		control: ['generalElementPart'],
		candidate: ['generalElement', 'generalElementPart', 'routineName'],
		policy: 'none',
	},
	{
		id: 'issue-3-full-file-ll-fallback',
		issue: 3,
		experiment: '007-full-file-ll-fallback',
		title: 'Resolve collection-method and BULK COLLECT fallbacks',
		control: ['generalElement', 'generalElementPart', 'routineName'],
		candidate: ALL_OPTIMIZATIONS,
		policy: 'fallback-removal',
	},
	{
		id: 'combined-final',
		issue: 6,
		experiment: '009-semantic-conformance',
		title: 'Combined final state against the unoptimized parser',
		control: [],
		candidate: ALL_OPTIMIZATIONS,
		policy: 'fallback-removal',
	},
];
