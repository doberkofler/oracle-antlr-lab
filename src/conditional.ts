type Directive = 'IF' | 'THEN' | 'ELSIF' | 'ELSE' | 'END' | 'ERROR';

const hidden = (value: string): string => value.replaceAll(/[^\r\n]/gu, ' ');

/**
 * Removes every directive token and literal-disabled branch range.
 *
 * The state machine evaluates only literal booleans. A non-literal condition
 * keeps both branches; that limitation is measured rather than hidden.
 *
 * @param source - Oracle source.
 * @returns Source with unchanged offsets and line numbers.
 */
export const prepareConditional = (source: string): string => {
	interface FrameType {
		parentDisabled: boolean;
		disabled: boolean;
		satisfied: boolean;
	}

	const matches = [...source.matchAll(/\$(IF|THEN|ELSIF|ELSE|END|ERROR)\b/giu)];
	const stack: FrameType[] = [];
	const ranges: [number, number][] = [];
	const upperSource = source.toUpperCase();

	const thenAfter = (start: number): number => upperSource.indexOf('$THEN', start);
	const literalCondition = (start: number, thenStart: number): boolean | null => {
		const condition = source.slice(start, thenStart).replaceAll(/\s/gu, '').toUpperCase();

		return condition === 'TRUE' ? true : condition === 'FALSE' ? false : null;
	};

	for (const [position, match] of matches.entries()) {
		const start = match.index ?? 0;
		const keyword = (match[1] ?? '').toUpperCase() as Directive;
		const end = start + match[0].length;
		const parent = stack.at(-1);
		const parentDisabled = parent?.disabled ?? false;

		if (keyword === 'IF') {
			const thenIndex = thenAfter(end);
			const condition = thenIndex < 0 ? null : literalCondition(end, thenIndex);

			stack.push({ parentDisabled, disabled: parentDisabled || condition === false, satisfied: condition === true });
		} else if (keyword === 'ELSIF' || keyword === 'ELSE') {
			if (parent !== undefined) {
				if (keyword === 'ELSIF') {
					const thenIndex = thenAfter(end);
					const condition = thenIndex < 0 ? null : literalCondition(end, thenIndex);

					parent.disabled = parent.parentDisabled || parent.satisfied || condition === false;
					parent.satisfied ||= condition === true;
				} else {
					parent.disabled = parent.parentDisabled || parent.satisfied;
					parent.satisfied = true;
				}
			}
		} else if (keyword === 'END') {
			stack.pop();
		}

		ranges.push([start, end]);

		const frame = stack.at(-1);
		const next = matches[position + 1]?.index ?? source.length;
		const thenIndex = keyword === 'IF' || keyword === 'ELSIF' ? thenAfter(end) : -1;

		if (thenIndex >= 0) {
			ranges.push([end, thenIndex]);
		}

		if (frame?.disabled ?? false) {
			ranges.push([end, Math.max(next, end)]);
		}
	}

	let output = source;

	for (const [start, end] of ranges.sort((left, right) => right[0] - left[0] || right[1] - left[1])) {
		output = `${output.slice(0, start)}${hidden(output.slice(start, end))}${output.slice(end)}`;
	}

	return output;
};
