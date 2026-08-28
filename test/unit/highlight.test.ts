// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the trimmed highlight.js registry (src/renderer/highlight.ts).
 *
 *  The point of the list is that it is smaller than "everything", so the risk it carries is a
 *  language quietly falling off it. These tests pin the names the engine depends on — including
 *  the ones it reaches only through an alias, and the ones `normalizeHighlightLang()` rewrites.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import hljs, { registeredLanguages } from '../../src/renderer/highlight';
import { MarkdownItEngine } from '../../src/renderer/engine';
import { getPlugins } from '../../src/renderer/plugins';

function render(text: string) {
	return new MarkdownItEngine(getPlugins()).render(text).html;
}

describe('the language list', () => {
	it('registers every language it names', () => {
		const missing = registeredLanguages.filter(name => !hljs.getLanguage(name));
		expect(missing).toEqual([]);
		// A guard against the list being gutted rather than edited.
		expect(registeredLanguages.length).toBeGreaterThan(40);
	});

	it('covers the common fence languages', () => {
		for (const lang of ['bash', 'json', 'python', 'rust', 'typescript', 'yaml']) {
			expect(hljs.getLanguage(lang), lang).toBeDefined();
		}
	});

	it('resolves the aliases the list relies on instead of registering', () => {
		// Each of these is an alias of a language above; losing the owner loses the alias too.
		for (const alias of ['sh', 'html', 'js', 'jsx', 'ts', 'toml', 'md', 'yml', 'cs', 'txt']) {
			expect(hljs.getLanguage(alias), alias).toBeDefined();
		}
	});

	it('resolves every name normalizeHighlightLang() rewrites to', () => {
		// engine.ts maps shell -> sh, py3 -> python, tsx -> jsx, jsonc -> json, c# -> cs.
		for (const target of ['sh', 'python', 'jsx', 'json', 'cs']) {
			expect(hljs.getLanguage(target), target).toBeDefined();
		}
	});

	it('does not register the whole library', () => {
		// The languages highlight.js bundles that this app deliberately leaves out.
		expect(hljs.getLanguage('brainfuck')).toBeUndefined();
		expect(hljs.listLanguages().length).toBe(registeredLanguages.length);
	});
});

describe('highlighting through the engine', () => {
	it('highlights a fence in a registered language', () => {
		const html = render('```json\n{ "a": 1 }\n```');
		expect(html).toContain('language-json');
		expect(html).toContain('hljs-attr');
	});

	it('highlights the aliases VS Code special-cased', () => {
		// `c#` is in samples/kitchen-sink.md, so this one is also asserted by the smoke run.
		expect(render('```c#\nvar x = 1;\n```')).toContain('hljs-keyword');
		expect(render('```shell\necho "hi"\n```')).toContain('hljs-string');
	});

	it('renders an unregistered language as escaped text, not markup', () => {
		const html = render('```brainfuck\n<a href="x">+++\n```');
		expect(html).toContain('language-brainfuck');
		expect(html).toContain('&lt;a href=&quot;x&quot;&gt;');
		expect(html).not.toContain('<a href="x">');
	});
});
