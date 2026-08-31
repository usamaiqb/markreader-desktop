// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for on-demand module loading (src/renderer/lazy.ts).
 *
 *  Only the detection matters here, and it is asymmetric: loading a module a document did not
 *  need costs a fetch and renders identically, while *not* loading one it did need renders
 *  math as literal `$x$` and code as plain text. So these tests are mostly about what must
 *  still be detected, and only lightly about what may be skipped.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { detectDocumentNeeds } from '../../src/renderer/lazy';

describe('math detection', () => {
	it('catches every delimiter KaTeX understands', () => {
		for (const text of [
			'inline $x^2$ math',
			'display $$x^2$$ math',
			'a block\n\n$$\nx^2\n$$\n',
			'```math\nx^2\n```',
			'~~~math\nx^2\n~~~',
		]) {
			expect(detectDocumentNeeds(text).math, text).toBe(true);
		}
	});

	it('errs towards loading rather than guessing', () => {
		// A price is not math, but a rule tight enough to know that would have to reimplement
		// KaTeX's delimiter matching. Loading it anyway renders exactly as before.
		expect(detectDocumentNeeds('it costs $5').math).toBe(true);
	});

	it('skips a document with no dollar sign anywhere', () => {
		expect(detectDocumentNeeds('# Heading\n\nProse, a [link](x.md), and a list.').math).toBe(false);
	});
});

describe('code detection', () => {
	it('catches both fence markers', () => {
		expect(detectDocumentNeeds('```js\nconst x = 1;\n```').code).toBe(true);
		expect(detectDocumentNeeds('~~~js\nconst x = 1;\n~~~').code).toBe(true);
	});

	it('catches a fence that is not the first line', () => {
		expect(detectDocumentNeeds('# Title\n\nProse.\n\n```sh\nls\n```').code).toBe(true);
	});

	it('catches front matter, which renders as highlighted YAML', () => {
		expect(detectDocumentNeeds('---\ntitle: A doc\n---\n\n# Heading').code).toBe(true);
	});

	it('skips prose, and inline code, which is never highlighted', () => {
		expect(detectDocumentNeeds('# Heading\n\nSome `inline code` in prose.').code).toBe(false);
	});

	it('skips an indented code block, which never reaches the highlight hook', () => {
		// markdown-it calls `options.highlight` from the fence rule only; an indented block is
		// a `code_block` token and renders escaped either way.
		expect(detectDocumentNeeds('paragraph\n\n    indented = true\n').code).toBe(false);
	});
});

describe('the two are independent', () => {
	it('loads neither for plain prose', () => {
		expect(detectDocumentNeeds('# Just words\n\nAnd more words.')).toEqual({
			code: false,
			math: false,
		});
	});

	it('loads both when a document has both', () => {
		expect(detectDocumentNeeds('$x^2$\n\n```js\nx\n```')).toEqual({ code: true, math: true });
	});
});
