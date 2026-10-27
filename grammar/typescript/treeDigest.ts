import { ParserRuleContext, type ParseTree, TerminalNode } from 'antlr4ng';
import { createHash } from 'node:crypto';

/**
 * Structural parse-tree digest used for conformance checks.
 *
 * The digest covers rule indices, child counts, terminal token types, and tree
 * shape. It deliberately excludes token text and source offsets so a digest
 * can be published for a private corpus.
 *
 * @param tree - Parse tree root.
 * @returns SHA-256 over rule indices, child counts, and terminal token types.
 */
export const treeSha256 = (tree: ParseTree): string => {
	const digest = createHash('sha256');
	const addInteger = (value: number): void => {
		digest.update(Buffer.from([value >>> 24, value >>> 16, value >>> 8, value]));
	};
	const addTree = (node: ParseTree): void => {
		if (node instanceof ParserRuleContext) {
			digest.update(Buffer.from([1]));
			addInteger(node.ruleIndex);
			addInteger(node.getChildCount());
		} else if (node instanceof TerminalNode) {
			digest.update(Buffer.from([2]));
			addInteger(node.symbol.type);
		} else {
			digest.update(Buffer.from([3]));
		}

		for (let childIndex = 0; childIndex < node.getChildCount(); childIndex += 1) {
			const child = node.getChild(childIndex);

			if (child !== null) {
				addTree(child);
			}
		}
	};

	addTree(tree);
	return digest.digest('hex');
};

/** Generated recognizer symbol tables used for name-stable tree digests. */
export type TreeVocabulary = Readonly<{
	ruleNames: readonly string[];
	symbolicNames: readonly (string | null)[];
	literalNames: readonly (string | null)[];
}>;

/** Rules that are structural wrappers and contribute no semantics. */
export type SymbolicTreeOptions = Readonly<{ ignoredRules?: readonly string[] }>;

/**
 * Structural parse-tree digest that is stable across grammar revisions.
 *
 * Rule and token identity is hashed by name instead of by numeric index. ANTLR
 * assigns indices in declaration order, so adding a token or rule renumbers
 * every later symbol even when the parsed structure is unchanged. The optional
 * ignored-rule list flattens declared wrapper rules so a refactor that only
 * introduces intermediate rules keeps the same digest.
 *
 * @param tree - Parse tree root.
 * @param vocabulary - Rule and token names of the generated recognizer.
 * @param options - Rules flattened out of the structure.
 * @returns SHA-256 over rule names, token names, and tree shape.
 */
export const treeSha256Symbolic = (tree: ParseTree, vocabulary: TreeVocabulary, options: SymbolicTreeOptions = {}): string => {
	const digest = createHash('sha256');
	const ignoredRules = new Set(options.ignoredRules ?? []);
	const addText = (kind: string, value: string): void => {
		digest.update(kind);
		digest.update(`${String(value.length)}:${value}`);
	};
	const tokenName = (type: number): string => {
		if (type === -1) {
			return 'EOF';
		}

		return vocabulary.symbolicNames[type] ?? vocabulary.literalNames[type] ?? `token-${String(type)}`;
	};
	const addTree = (node: ParseTree): void => {
		if (node instanceof ParserRuleContext) {
			const ruleName = vocabulary.ruleNames[node.ruleIndex] ?? `rule-${String(node.ruleIndex)}`;
			const flattened = ignoredRules.has(ruleName);

			if (!flattened) {
				addText('R', ruleName);
			}

			for (let childIndex = 0; childIndex < node.getChildCount(); childIndex += 1) {
				const child = node.getChild(childIndex);

				if (child !== null) {
					addTree(child);
				}
			}

			if (!flattened) {
				addText('E', ruleName);
			}

			return;
		}

		if (node instanceof TerminalNode) {
			addText('T', tokenName(node.symbol.type));
			return;
		}

		addText('X', '');
	};

	addTree(tree);
	return digest.digest('hex');
};
