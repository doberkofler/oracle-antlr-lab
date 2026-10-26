import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { type GeneratedParserOptimization, GENERATED_PARSER_OPTIMIZATIONS, optimizeGeneratedParser } from '../src/generatedParserOptimization.ts';

const KNOWN_OPTIMIZATIONS: readonly GeneratedParserOptimization[] = GENERATED_PARSER_OPTIMIZATIONS;

const parseOptimizations = (value: string): readonly GeneratedParserOptimization[] => {
	const selected = value
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);

	if (selected.length === 0) {
		throw new Error('LAB_GENERATED_OPTIMIZATIONS must name at least one optimization');
	}

	const known = selected.map((name) => {
		const optimization = KNOWN_OPTIMIZATIONS.find((candidate) => candidate === name);

		if (optimization === undefined) {
			throw new Error(`Unknown generated-parser optimization: ${name}`);
		}

		return optimization;
	});

	if (new Set(known).size !== known.length) {
		throw new Error('LAB_GENERATED_OPTIMIZATIONS contains a duplicate optimization');
	}

	if (known.includes('collectionMethodCall') && !known.includes('generalElement')) {
		throw new Error('collectionMethodCall requires generalElement');
	}

	return known;
};

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'grammar', 'typescript', 'generated');
const runner = path.join(root, 'node_modules', 'antlr-ng', 'dist', 'cli', 'runner.js');
const lexer = path.join(output, 'PlSqlLexer.ts');
const parser = path.join(output, 'PlSqlParser.ts');
const visitor = path.join(output, 'PlSqlParserVisitor.ts');
const optimizations = parseOptimizations(process.env['LAB_GENERATED_OPTIMIZATIONS'] ?? GENERATED_PARSER_OPTIMIZATIONS.join(','));

rmSync(output, { recursive: true, force: true });

const result = spawnSync(
	process.execPath,
	[
		runner,
		'-Dlanguage=TypeScript',
		'--generate-listener',
		'false',
		'--generate-visitor',
		'true',
		'-o',
		output,
		path.join(root, 'grammar', 'adapted', 'PlSqlLexer.g4'),
		path.join(root, 'grammar', 'adapted', 'PlSqlParser.g4'),
	],
	{ cwd: root, stdio: 'inherit' },
);

if (result.status !== 0) {
	throw new Error(`antlr-ng failed with status ${String(result.status)}`);
}

const stripUnusedPreviousContext = (source: string): string => {
	const lines = source.split('\n');
	const removed = new Set<number>();
	const methodStart = /^ {4}(?:public|private|protected) .*\{$/u;
	const blockEnd = (start: number): number => {
		let depth = 0;

		for (let index = start; index < lines.length; index += 1) {
			depth += (lines[index]?.match(/\{/gu) ?? []).length - (lines[index]?.match(/\}/gu) ?? []).length;

			if (depth === 0 && index > start) {
				return index;
			}
		}

		throw new Error('Unterminated generated method block');
	};

	for (const [start, line] of lines.entries()) {
		if (!methodStart.test(line)) {
			continue;
		}

		const end = blockEnd(start);
		const block = lines.slice(start, end + 1);
		const assignments = block.filter((candidate) => candidate.includes('previousContext'));

		if (assignments.length === 0 || !assignments.every((candidate) => /^\s*(?:let )?previousContext = localContext;$/u.test(candidate))) {
			continue;
		}

		for (let index = start; index <= end; index += 1) {
			if (/^\s*(?:let )?previousContext = localContext;$/u.test(lines[index] ?? '')) {
				removed.add(index);
			}
		}
	}

	return lines.filter((_, index) => !removed.has(index)).join('\n');
};

// Node's native type stripping requires explicit `.ts` extensions. Keep the
// generated source otherwise unchanged.
const useTypeScriptExtensions = (source: string): string => source.replaceAll(/(from\s+['"][^'"]+)\.js(['"])/gu, '$1.ts$2');

const lexerText = useTypeScriptExtensions(
	readFileSync(lexer, 'utf8')
		.replace('import { Token } from "antlr4ng";\n', '')
		.replaceAll('_sempred(localContext: antlr.ParserRuleContext | null', '_sempred(_localContext: antlr.ParserRuleContext | null'),
);
const parserText = useTypeScriptExtensions(
	optimizeGeneratedParser(
		stripUnusedPreviousContext(
			readFileSync(parser, 'utf8')
				.replace(
					'// for running tests with parameters, TODO: discuss strategy for typed parameters in CI\n// eslint-disable-next-line no-unused-vars\ntype int = number;\n\n',
					'',
				)
				.replaceAll(/_sempred\(localContext: (?<context>\w+)Context \| null/gu, '_sempred(_localContext: $<context>Context | null'),
		),
		optimizations,
	),
);
const visitorText = useTypeScriptExtensions(readFileSync(visitor, 'utf8').replace('import {PlSqlParserBase} from "../plSqlParserBase.js";\n\n', ''));

for (const artifact of ['PlSqlLexer.interp', 'PlSqlLexer.tokens', 'PlSqlParser.interp', 'PlSqlParser.tokens']) {
	rmSync(path.join(output, artifact), { force: true });
}

writeFileSync(lexer, lexerText);
writeFileSync(parser, parserText);
writeFileSync(visitor, visitorText);
process.stdout.write(`Generated TypeScript recognizers in ${path.relative(root, output)}\n`);
