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
