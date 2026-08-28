// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the markdown-it engine (src/renderer/engine.ts).
 *
 *  The engine is built the same way the renderer builds it (`getPlugins()`), so the output
 *  is asserted against the real plugin set: task lists, math, front matter.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { MarkdownItEngine } from '../../src/renderer/engine';
import { getPlugins } from '../../src/renderer/plugins';
import { setConfig } from '../../src/renderer/config';

function render(text: string, context?: Parameters<MarkdownItEngine['render']>[1]) {
	const engine = new MarkdownItEngine(getPlugins());
	return engine.render(text, context);
}

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
		expect(html).toContain('data-mermaid-src');
		expect(html).not.toContain('<svg');
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
