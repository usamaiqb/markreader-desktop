// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the document sanitizer (src/renderer/sanitizer.ts).
 *
 *  Two halves, and both matter. The first is what must be removed — the reason the file
 *  exists. The second is what must survive: markdown-it, KaTeX and the engine's own
 *  attributes all put things in the HTML that look exotic to a sanitizer, and a config that
 *  quietly ate one of them would break rendering rather than security, which is the failure
 *  nobody notices until a document looks wrong.
 *
 *  This runs under jsdom rather than the suite's usual node environment: DOMPurify parses
 *  with the DOM it is given, so there has to be one.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { sanitizeDocumentHtml } from '../../src/renderer/sanitizer';
import { MarkdownItEngine } from '../../src/renderer/engine';
import { getPlugins } from '../../src/renderer/plugins';

describe('what the sanitizer removes', () => {
	it('strips an inline event handler', () => {
		// The sanitizer's core promise, in its cheapest form.
		const html = sanitizeDocumentHtml('<img src="x" onerror="alert(1)">');
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('alert');
	});

	it('strips a script element and its contents', () => {
		const html = sanitizeDocumentHtml('<p>before</p><script>alert(1)</script><p>after</p>');
		expect(html).not.toContain('script');
		expect(html).not.toContain('alert');
		expect(html).toContain('before');
		expect(html).toContain('after');
	});

	it('strips framing and embedding elements', () => {
		for (const tag of ['iframe', 'object', 'embed', 'frame']) {
			const html = sanitizeDocumentHtml(`<${tag} src="https://example.com"></${tag}>`);
			expect(html, `${tag} survived`).not.toContain(tag);
		}
	});

	it('strips a document-supplied stylesheet', () => {
		// CSS is an exfiltration channel; see the FORBID_TAGS note in the sanitizer.
		expect(sanitizeDocumentHtml('<style>body{background:url(https://e/x)}</style>'))
			.not.toContain('background');
		expect(sanitizeDocumentHtml('<link rel="stylesheet" href="https://e/x.css">'))
			.not.toContain('stylesheet');
	});

	it('strips a javascript: URL', () => {
		expect(sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
	});

	it('strips a form', () => {
		expect(sanitizeDocumentHtml('<form action="https://e/"><input name="p"></form>'))
			.not.toContain('<form');
	});

	it('strips target and ping from links', () => {
		const html = sanitizeDocumentHtml('<a href="https://example.com" target="_blank" ping="https://e/">x</a>');
		expect(html).not.toContain('target');
		expect(html).not.toContain('ping');
	});
});

describe('what the sanitizer keeps', () => {
	it('keeps the mdr: scheme local images resolve to', () => {
		// Not in DOMPurify's default allowlist — without the override every local image in
		// every document would silently vanish.
		const html = sanitizeDocumentHtml('<img src="mdr://localhost/C%3A/docs/img.png" alt="a">');
		expect(html).toContain('mdr://localhost/C%3A/docs/img.png');
	});

	it('keeps the engine attributes the renderer navigates by', () => {
		const html = sanitizeDocumentHtml(
			'<a href="#x" data-href="other.md" data-resolved-path="/docs/other.md">x</a>');
		expect(html).toContain('data-href');
		expect(html).toContain('data-resolved-path');
	});

	it('keeps the source-map line attributes and heading ids', () => {
		const html = sanitizeDocumentHtml('<h2 id="a-heading" class="code-line" data-line="4">A heading</h2>');
		expect(html).toContain('id="a-heading"');
		expect(html).toContain('data-line="4"');
		expect(html).toContain('code-line');
	});

	it('keeps the mermaid placeholder and its source text', () => {
		const html = sanitizeDocumentHtml(
			'<div class="mermaid-block"><pre class="mermaid-fallback">graph TD;\nA--&gt;B;</pre></div>');
		expect(html).toContain('mermaid-block');
		expect(html).toContain('A--&gt;B;');
	});

	it('drops an attribute whose value contains an HTML comment terminator', () => {
		// DOMPurify's mXSS defence, and the reason the diagram source moved out of
		// `data-mermaid-src` into element text: `-->` is mermaid's arrow, so every flowchart
		// in existence lost its source here. Pinned so the constraint stays visible.
		expect(sanitizeDocumentHtml('<div data-x="A--&gt;B">y</div>')).not.toContain('data-x');
		expect(sanitizeDocumentHtml('<div data-x="A-B">y</div>')).toContain('data-x');
	});

	it('keeps task list checkboxes', () => {
		const html = sanitizeDocumentHtml('<input type="checkbox" disabled checked>');
		expect(html).toContain('type="checkbox"');
	});

	it('keeps KaTeX inline styles and MathML', () => {
		const html = sanitizeDocumentHtml(
			'<span class="katex"><math><mi>x</mi></math><span style="height:0.8em;">x</span></span>');
		expect(html).toContain('math');
		expect(html).toContain('style="height:0.8em;"');
	});

	it('keeps the raw HTML passthrough the smoke suite asserts', () => {
		const html = sanitizeDocumentHtml('<div align="center"><strong>centered</strong></div>');
		expect(html).toContain('align="center"');
		expect(html).toContain('<strong>');
	});

	it('keeps remote and data images', () => {
		expect(sanitizeDocumentHtml('<img src="https://example.com/x.png">')).toContain('https://example.com/x.png');
		expect(sanitizeDocumentHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain('data:image/png');
	});

	it('keeps a table with its wrapper classes', () => {
		const html = sanitizeDocumentHtml('<table class="frontmatter" dir="auto"><tr><td>a</td></tr></table>');
		expect(html).toContain('frontmatter');
		expect(html).toContain('dir="auto"');
	});
});

describe('local resources in raw HTML', () => {
	// A stand-in for the engine's resolver: relative references resolve beside the document.
	const resolve = (href: string) => (/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `mdr://localhost/C%3A/docs/${href}`);

	it('rewrites a relative <img src> and keeps the original in data-src', () => {
		const html = sanitizeDocumentHtml('<p align="center"><img src="shots/a.png" width="800"></p>', resolve);
		expect(html).toContain('src="mdr://localhost/C%3A/docs/shots/a.png"');
		expect(html).toContain('data-src="shots/a.png"');
		expect(html).toContain('width="800"');
	});

	it('rewrites every candidate of a <picture> srcset', () => {
		const html = sanitizeDocumentHtml(
			'<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png 1x, dark@2x.png 2x"><img src="light.png"></picture>',
			resolve,
		);
		expect(html).toContain('srcset="mdr://localhost/C%3A/docs/dark.png 1x, mdr://localhost/C%3A/docs/dark@2x.png 2x"');
		expect(html).toContain('src="mdr://localhost/C%3A/docs/light.png"');
	});

	it('rewrites video src and poster', () => {
		const html = sanitizeDocumentHtml('<video src="clip.mp4" poster="poster.png"></video>', resolve);
		expect(html).toContain('src="mdr://localhost/C%3A/docs/clip.mp4"');
		expect(html).toContain('poster="mdr://localhost/C%3A/docs/poster.png"');
	});

	it('leaves remote images alone', () => {
		const html = sanitizeDocumentHtml('<img src="https://img.shields.io/badge/x-y-blue">', resolve);
		expect(html).toContain('src="https://img.shields.io/badge/x-y-blue"');
		expect(html).not.toContain('data-src');
	});

	it('does not rewrite an image the engine already rewrote', () => {
		const html = sanitizeDocumentHtml('<img src="mdr://localhost/C%3A/docs/a.png" data-src="a.png">', () => 'wrong');
		expect(html).toContain('src="mdr://localhost/C%3A/docs/a.png"');
	});

	it('rewrites nothing without a resolver, and the next call does not inherit one', () => {
		sanitizeDocumentHtml('<img src="a.png">', resolve);
		expect(sanitizeDocumentHtml('<img src="a.png">')).toContain('src="a.png"');
	});

	it('resolves raw HTML images against the document, end to end through the engine', () => {
		const output = new MarkdownItEngine(getPlugins()).render(
			'<img src="metadata/screenshots/01.png">\n\n![md](./images/photo.png)',
			{ documentPath: 'C:/repo/README.md' },
		);
		const html = sanitizeDocumentHtml(output.html, output.resolveResource);
		expect(html).toMatch(/src="(mdr:\/\/localhost|http:\/\/mdr\.localhost)\/C%3A\/repo\/metadata\/screenshots\/01\.png"/);
		expect(html).toMatch(/src="(mdr:\/\/localhost|http:\/\/mdr\.localhost)\/C%3A\/repo\/images\/photo\.png"/);
	});
});
