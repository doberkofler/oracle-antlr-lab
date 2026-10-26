import { describe, expect, it } from 'vitest';
import { prepareConditional } from '../src/conditional.ts';

const compact = (value: string): string => value.replaceAll(/\s/gu, '');

describe('conditional compilation preprocessing', () => {
	it('blanks a literal-false branch and keeps the else branch', () => {
		const result = compact(prepareConditional('$IF FALSE $THEN hidden_thing; $ELSE visible_thing; $END'));

		expect(result).not.toContain('hidden_thing');
		expect(result).toContain('visible_thing');
		expect(result).not.toMatch(/\$(IF|THEN|ELSE|END)/u);
	});

	it('keeps a literal-true branch and blanks the else branch', () => {
		const result = compact(prepareConditional('$IF TRUE $THEN visible_thing; $ELSE hidden_thing; $END'));

		expect(result).toContain('visible_thing');
		expect(result).not.toContain('hidden_thing');
	});

	it('keeps both branches of a non-literal condition', () => {
		const result = compact(prepareConditional('$IF $$FLAG $THEN first_thing; $ELSE second_thing; $END'));

		expect(result).toContain('first_thing');
		expect(result).toContain('second_thing');
		expect(result).not.toMatch(/\$(IF|THEN|ELSE|END)/u);
	});

	it('preserves byte length and line numbers', () => {
		const source = '$IF FALSE $THEN\nhidden;\n$END\nvisible;\n';
		const result = prepareConditional(source);

		expect(result).toHaveLength(source.length);
		expect(result.split('\n')).toHaveLength(source.split('\n').length);
	});
});
