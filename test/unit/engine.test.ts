// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the markdown-it engine (src/renderer/engine.ts).
 *
 *  The engine is built the same way the renderer builds it (`getPlugins()`), so the output
 *  is asserted against the real plugin set: task lists, math, front matter.
 *--------------------------------------------------------------------------------------------*/

import { beforeAll, describe, expect, it } from 'vitest';
import { MarkdownItEngine } from '../../src/renderer/engine';
import { ensureHighlighter, ensureMath } from '../../src/renderer/lazy';
import { getPlugins } from '../../src/renderer/plugins';
import { setConfig } from '../../src/renderer/config';

function render(text: string, context?: Parameters<MarkdownItEngine['render']>[1]) {
	const engine = new MarkdownItEngine(getPlugins());
	return engine.render(text, context);
}

// KaTeX and highlight.js load on demand; the app does it from `prepareForDocument` before it
// paints. These tests assert the fully loaded output, so they load both up front.
beforeAll(() => Promise.all([ensureHighlighter(), ensureMath()]));

describe('MarkdownItEngine', () => {
	it('renders headings and collects the outline', () => {
		const { html, headings } = render('# One\n\n## Two\n\n### Three');
		expect(html).toContain('<h1');
		expect(headings.map(h => h.text)).toEqual(['One', 'Two', 'Three']);
		expect(headings.map(h => h.level)).toEqual([1, 2, 3]);
		expect(headings.map(h => h.slug)).toEqual(['one', 'two', 'three']);
	});

	it('gives duplicate headings unique slugs', () => {
		const { html } = render('# Foo\n\n# Foo\n\n# Foo');
		const ids = [...html.matchAll(/<h1[^>]*id="([^"]+)"/g)].map(m => m[1]);
		expect(ids).toEqual(['foo', 'foo-1', 'foo-2']);
	});

	it('adds data-line attributes for the source map', () => {
		const { html } = render('a paragraph\n\n# heading');
		expect(html).toMatch(/data-line="0"/);
		expect(html).toMatch(/data-line="2"/);
		expect(html).toContain('code-line');
	});

	it('wraps fenced code with a hljs class and language', () => {
		const { html } = render('```ts\nconst x = 1;\n```');
		expect(html).toContain('hljs');
		expect(html).toContain('language-ts');
	});

	it('emits a mermaid placeholder instead of the raw diagram', () => {
		const { html } = render('```mermaid\ngraph TD;\nA-->B;\n```');
		expect(html).toContain('mermaid-block');
		expect(html).not.toContain('<svg');
	});

	it('renders math once KaTeX is loaded', () => {
		// The plugin set is built from `getPlugins()`, which leaves math out until the module
		// has loaded — so this also pins that `beforeAll` above actually loaded it. The
		// CommonJS interop that breaks only in the bundled build is the smoke suite's job.
		const { html } = render('$x^2$ and $$y^2$$');
		expect(html).toContain('katex');
		expect(html).not.toContain('$x^2$');
	});

	it('puts dir="auto" on a table but not on its rows or cells', () => {
		// `dir="auto"` skips descendants that carry their own `dir`, so a table whose rows and
		// cells all had one had nothing left to read and fell back to ltr — laying an RTL
		// table's columns out backwards.
		const { html } = render('| a | b |\n| --- | --- |\n| 1 | 2 |');
		expect(html).toMatch(/<table[^>]*dir="auto"/);
		expect(html).not.toMatch(/<thead[^>]*dir=/);
		expect(html).not.toMatch(/<tbody[^>]*dir=/);
		expect(html).not.toMatch(/<tr[^>]*dir=/);
		expect(html).not.toMatch(/<t[hd][^>]*dir=/);
	});

	it('still marks table internals with source-map lines', () => {
		// Only `dir` is withheld from them; `data-line` and `code-line` are unaffected.
		const { html } = render('| a |\n| --- |\n| 1 |');
		expect(html).toMatch(/<tr[^>]*data-line=/);
	});

	it('carries the diagram source in the fallback element, not an attribute', () => {
		// An attribute would not survive the sanitizer: DOMPurify drops any value containing
		// `-->`, which is every flowchart arrow. See `#addMermaidRenderer`.
		const { html } = render('```mermaid\ngraph TD;\nA-->B;\n```');
		expect(html).toContain('<pre class="mermaid-fallback">graph TD;\nA--&gt;B;');
		expect(html).not.toContain('data-mermaid-src');
	});

	it('renders task list markers as checkboxes', () => {
		const { html } = render('- [x] done\n- [ ] todo');
		expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
		expect(html).toMatch(/<input[^>]*type="checkbox"/);
		expect(html).toContain('task-list-item');
	});

	it('renders raw HTML when html is enabled', () => {
		const { html } = render('<div align="center"><strong>hi</strong></div>');
		expect(html).toContain('<strong>hi</strong>');
	});

	it('rewrites relative images to the mdr:// protocol', () => {
		const { html } = render('![alt](img.png)', { documentPath: 'C:/docs/file.md' });
		expect(html).toContain('data-src="img.png"');
		expect(html).toMatch(/src="(mdr:\/\/localhost|http:\/\/mdr\.localhost)\/C%3A\/docs\/img\.png"/);
	});

	it('keeps absolute http image urls untouched', () => {
		const { html } = render('![alt](https://example.com/img.png)', {
			documentPath: 'C:/docs/file.md',
		});
		expect(html).toContain('src="https://example.com/img.png"');
	});

	it('resolves relative markdown links to absolute paths', () => {
		const { html } = render('[next](other.md)', { documentPath: 'C:/docs/file.md' });
		expect(html).toContain('data-href="other.md"');
		expect(html).toContain('data-resolved-path="C:/docs/other.md"');
	});

	it('renders front matter as a table by default', () => {
		const { html } = render('---\ntitle: My doc\ntags: [a, b]\n---\n\n# Body');
		expect(html).toContain('class="frontmatter"');
		expect(html).toContain('<th>title</th>');
		expect(html).toContain('<li>a</li>');
	});

	it('hides front matter when the config asks for it', () => {
		setConfig({ frontMatter: 'hide' });
		try {
			const { html } = render('---\ntitle: My doc\n---\n\n# Body');
			expect(html).not.toContain('frontmatter');
		} finally {
			setConfig({ frontMatter: 'table' });
		}
	});

	it('renders an error block for invalid front matter', () => {
		const { html } = render('---\ntitle: "unterminated\n---\n\n# Body');
		expect(html).toContain('frontmatter-error');
	});
});
