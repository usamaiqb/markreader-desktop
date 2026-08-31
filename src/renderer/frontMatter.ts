/*---------------------------------------------------------------------------------------------
 *  SPDX-License-Identifier: GPL-3.0-only
 *  SPDX-FileCopyrightText: 2026 DigiGate
 *  SPDX-FileCopyrightText: Microsoft Corporation — MIT, see licenses/vscode.txt
 *
 *  Contains code derived from Visual Studio Code. See licenses/NOTICE.md for what this file
 *  derives from and how much it changed.
 *--------------------------------------------------------------------------------------------*/
// Ported from vscode/extensions/markdown-language-features/src/extensions/yamlPreamble/yamlPreamble.ts
//
// Changes from the original:
//   - `vscode.workspace.getConfiguration('markdown').get('preview.frontMatter')` -> getConfig()
//   - `vscode.l10n.t(...)` -> plain strings
//   - dropped the `data-vscode-context` attribute (webview context menus only)

import type { MarkdownIt, MarkdownItOptions, StateBlock, Token } from 'markdown-it';
import * as yaml from 'yaml';
import { escapeHtml } from './util';
import { getConfig, type FrontMatterRenderStyle } from './config';

const FRONT_MATTER_TOKEN = 'front_matter';
const MARKER = '---';

interface IFrontMatterMeta {
	readonly content: string;
	/** markdown-it 15 types `Token.meta` as an open record; this has to be assignable to one. */
	[key: string]: unknown;
}

/**
 * Extends a `markdown-it` instance with parsing and rendering support for YAML
 * frontmatter at the start of a Markdown document.
 */
export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
	md.block.ruler.before('fence', FRONT_MATTER_TOKEN, frontMatterRule, {
		alt: ['paragraph', 'reference', 'blockquote', 'list']
	});

	md.renderer.rules[FRONT_MATTER_TOKEN] = renderFrontMatter;

	return md;
}

const frontMatterRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
	if (startLine !== 0 || state.tShift[startLine] !== 0) {
		return false;
	}

	const firstLineStart = state.bMarks[startLine];
	const firstLineEnd = state.eMarks[startLine];
	const firstLine = state.src.slice(firstLineStart, firstLineEnd).replace(/\s+$/, '');

	if (firstLine !== MARKER) {
		return false;
	}

	let nextLine = startLine + 1;
	let foundEnd = false;
	for (; nextLine < endLine; nextLine++) {
		if (state.tShift[nextLine] !== 0) {
			continue;
		}
		const lineStart = state.bMarks[nextLine];
		const lineEnd = state.eMarks[nextLine];
		const line = state.src.slice(lineStart, lineEnd).replace(/\s+$/, '');
		if (line === MARKER) {
			foundEnd = true;
			break;
		}
	}

	if (!foundEnd) {
		return false;
	}

	if (silent) {
		return true;
	}

	const contentStart = state.bMarks[startLine + 1];
	const contentEnd = state.bMarks[nextLine];
	const rawContent = state.src.slice(contentStart, contentEnd).replace(/\n$/, '');

	const token = state.push(FRONT_MATTER_TOKEN, '', 0);
	token.block = true;
	token.hidden = false;
	token.markup = MARKER;
	token.map = [startLine, nextLine + 1];
	const meta: IFrontMatterMeta = { content: rawContent };
	token.meta = meta;

	state.line = nextLine + 1;
	return true;
};

function renderFrontMatter(tokens: Token[], idx: number, options: MarkdownItOptions): string {
	const meta = tokens[idx].meta as IFrontMatterMeta | undefined;
	if (!meta) {
		return '';
	}

	const style: FrontMatterRenderStyle = getConfig().frontMatter;

	switch (style) {
		case 'codeBlock':
			return renderAsCodeBlock(meta, options);
		case 'table':
			return renderAsTable(meta);
		case 'hide':
		default:
			return '';
	}
}

function renderAsCodeBlock(meta: IFrontMatterMeta, options: MarkdownItOptions): string {
	let highlighted: string | undefined;
	if (typeof options.highlight === 'function') {
		try {
			highlighted = options.highlight(meta.content, 'yaml', '') || undefined;
		} catch {
			highlighted = undefined;
		}
	}
	if (highlighted?.startsWith('<pre')) {
		return highlighted.replace(/^<pre\b/, `<pre ${frontMatterAttributes()}`) + '\n';
	}
	const body = highlighted ?? escapeHtml(meta.content);
	return `<pre class="frontmatter hljs" ${frontMatterAttributes()}><code class="language-yaml">${body}</code></pre>\n`;
}

function renderAsTable(meta: IFrontMatterMeta): string {
	const result = parseEntries(meta);
	if (result.error !== undefined) {
		return renderError(result.error);
	}
	if (!result.entries.length) {
		return '';
	}
	const rows = result.entries.map(([key, value]) =>
		`<tr><th>${escapeHtml(key)}</th><td>${formatValueHtml(value)}</td></tr>`
	).join('');
	return `<table class="frontmatter" ${frontMatterAttributes()}><tbody>${rows}</tbody></table>\n`;
}

function renderError(message: string): string {
	return `<div class="frontmatter-error" role="alert" ${frontMatterAttributes()}><strong>Failed to parse frontmatter</strong><pre>${escapeHtml(message)}</pre></div>\n`;
}

function frontMatterAttributes(): string {
	return `title="Frontmatter"`;
}

interface IParseResult {
	readonly entries: readonly [string, unknown][];
	readonly error?: string;
}

function parseEntries(meta: IFrontMatterMeta): IParseResult {
	try {
		const parsed = yaml.parse(meta.content);
		if (parsed === null || parsed === undefined) {
			return { entries: [] };
		}
		if (typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { entries: [['', parsed]] };
		}
		return { entries: Object.entries(parsed as Record<string, unknown>) };
	} catch (e) {
		return { entries: [], error: e instanceof Error ? e.message : String(e) };
	}
}

function formatValueHtml(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (Array.isArray(value)) {
		if (!value.length) {
			return '';
		}
		return `<ul>${value.map(v => `<li>${formatValueHtml(v)}</li>`).join('')}</ul>`;
	}
	if (typeof value === 'object') {
		return `<code>${escapeHtml(yaml.stringify(value).trimEnd())}</code>`;
	}
	return escapeHtml(formatScalar(value));
}

function formatScalar(value: unknown): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return String(value);
}
