/** Accepted/rejected outcome of one parse. */
export type FixtureOutcome = 'accepted' | 'rejected';

/** Declared control/candidate outcome for one reduced upstream fixture. */
export type FixtureExpectation = Readonly<{
	state: string;
	file: string;
	control: FixtureOutcome;
	candidate: FixtureOutcome;
	reason: string;
}>;

/**
 * Fixture transitions declared by the open upstream pull requests.
 *
 * Each entry states what the reduced fixture must prove: the control outcome,
 * the candidate outcome, and why that transition is the intended fix. A gate
 * fails when the observed outcome differs, and any other fixture difference
 * remains a defect.
 */
export const UPSTREAM_GRAMMAR_FIXTURES: readonly FixtureExpectation[] = [
	{
		state: 'pr-5127',
		file: '5127-sqlplus_remark_prompt_whitespace.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'A tab after REM/REMARK/PROMPT was not recognised as a SQL*Plus command.',
	},
	{
		state: 'pr-5128',
		file: '5128-xmltable_returning_sequence_by_ref.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'XMLTABLE did not accept RETURNING SEQUENCE BY REF.',
	},
	{
		state: 'pr-5129',
		file: '5129-sqlplus_exec_command.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'SQL*Plus EXEC[UTE] had no grammar rule.',
	},
	{
		state: 'pr-5131',
		file: '5131-keywordasidentifier06.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'DATE was not accepted as an identifier.',
	},
	{
		state: 'pr-5131',
		file: '5131-keywordasidentifier07.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'DETECTED was not accepted as an identifier.',
	},
	{
		state: 'pr-5131',
		file: '5131-keywordasidentifier08.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'ENCLOSED was not accepted as an identifier.',
	},
	{
		state: 'pr-5133',
		file: '5133-create_analytic_view_dim_key.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'dim_key required exactly two attribute names and mislabelled repeated keys.',
	},
	{
		state: 'pr-5134',
		file: '5134-alter_table_empty.sql',
		control: 'accepted',
		candidate: 'rejected',
		reason: 'The empty ALTER TABLE alternative accepted a statement with no action.',
	},
	{
		state: 'pr-5135',
		file: '5135-time_zone.sql',
		control: 'rejected',
		candidate: 'accepted',
		reason: 'SET TIME_ZONE and TIMESTAMP WITH TIME ZONE used the wrong tokens.',
	},
];

/**
 * Fixtures that must not change acceptance in any state.
 *
 * They prove that the grammar refactors keep existing valid statements valid.
 */
export const UPSTREAM_GRAMMAR_STABLE_FIXTURES: readonly Readonly<{ state: string; file: string; reason: string }>[] = [
	{
		state: 'pr-5132',
		file: '5132-atom_subquery_operation.sql',
		reason: 'Removing the redundant atom alternative must not change a valid parenthesised subquery.',
	},
	{
		state: 'pr-5134',
		file: '5134-alter_table_actions.sql',
		reason: 'The ALTER TABLE restructure must keep every existing action form valid.',
	},
];
