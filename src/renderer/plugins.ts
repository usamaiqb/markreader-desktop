/*---------------------------------------------------------------------------------------------
 *  SPDX-License-Identifier: GPL-3.0-only
 *  SPDX-FileCopyrightText: 2026 DigiGate
 *  SPDX-FileCopyrightText: Microsoft Corporation — MIT, see licenses/vscode.txt
 *
 *  Contains code derived from Visual Studio Code. See licenses/NOTICE.md for what this file
 *  derives from and how much it changed.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Replaces VS Code's `MarkdownContributionProvider`.
 *
 *  In VS Code, math and Mermaid live in separate extensions (`markdown-math` and
 *  `mermaid-markdown-features`) that hook into the preview through
 *  `extendMarkdownIt`. Here they're just plugins in a list.
 *--------------------------------------------------------------------------------------------*/

import type MarkdownIt from 'markdown-it';
import type { PluginSimple, PluginWithOptions } from 'markdown-it';
import katexPlugin from '@vscode/markdown-it-katex';
import { getConfig } from './config';

/**
 * Ported from vscode/extensions/markdown-math/src/extension.ts.
 * The macro table is reset per render so a `\newcommand` in one document can't
 * leak into the next.
 */
function mathPlugin(md: MarkdownIt): MarkdownIt {
	const options = {
		enableFencedBlocks: true,
		globalGroup: true,
		macros: { ...getConfig().mathMacros },
	};
	md.core.ruler.push('reset-katex-macros', () => {
		options.macros = { ...getConfig().mathMacros };
		return true;
	});
	return md.use(katexPlugin as unknown as PluginWithOptions, options);
}

/**
 * Renders `- [ ]` / `- [x]` list items as checkboxes.
 *
 * NOTE: this is a MarkReader addition, not a port. VS Code's preview has no task-list
 * plugin, so it renders the literal text `[x]` — fine in an editor next to the source,
 * misleading in a standalone reader.
 */
function taskListPlugin(md: MarkdownIt): MarkdownIt {
	md.core.ruler.after('inline', 'task-lists', state => {
		for (let i = 0; i < state.tokens.length - 2; i++) {
			const open = state.tokens[i];
			const inline = state.tokens[i + 2];
			if (open.type !== 'list_item_open' || inline.type !== 'inline') {
				continue;
			}

			const match = /^\[([ xX])\]\s+/.exec(inline.content);
			if (!match) {
				continue;
			}

			const checked = match[1].toLowerCase() === 'x';
			inline.content = inline.content.slice(match[0].length);

			// The inline token has already been parsed into children, so the marker has to
			// be stripped from the first text child too.
			const firstText = inline.children?.find(c => c.type === 'text');
			if (firstText) {
				firstText.content = firstText.content.replace(/^\[([ xX])\]\s+/, '');
			}

			const checkbox = new state.Token('html_inline', '', 0);
			checkbox.content = `<input type="checkbox" disabled${checked ? ' checked' : ''}>`;
			inline.children?.unshift(checkbox);

			open.attrJoin('class', 'task-list-item');
		}
		return true;
	});
	return md;
}

/**
 * The set of markdown-it plugins for the current configuration.
 * Changing this requires `engine.reloadPlugins()`.
 */
export function getPlugins(): PluginSimple[] {
	const plugins: PluginSimple[] = [taskListPlugin];
	if (getConfig().math) {
		plugins.push(mathPlugin);
	}
	// Mermaid is not a markdown-it plugin here — the engine emits a placeholder for
	// ```mermaid fences and the renderer hydrates them after layout. See engine.ts.
	return plugins;
}
