// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the GitHub-slugifier port (src/renderer/slugify.ts).
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { githubSlugifier } from '../../src/renderer/slugify';

describe('githubSlugifier.fromHeading', () => {
	it('lowercases and replaces spaces with dashes', () => {
		expect(githubSlugifier.fromHeading('Hello World').value).toBe('hello-world');
	});

	it('strips punctuation', () => {
		expect(githubSlugifier.fromHeading('What is it? 42!').value).toBe('what-is-it-42');
	});

	it('trims surrounding whitespace', () => {
		expect(githubSlugifier.fromHeading('  Mixed Case  ').value).toBe('mixed-case');
	});

	it('keeps unicode letters', () => {
		expect(githubSlugifier.fromHeading('Crème brûlée').value).toBe('crème-brûlée');
	});

	it('handles a heading that is only punctuation', () => {
		expect(githubSlugifier.fromHeading('?!').value).toBe('');
	});
});

describe('githubSlugifier.createBuilder', () => {
	it('makes duplicate headings unique in document order', () => {
		const builder = githubSlugifier.createBuilder();
		expect(builder.add('Foo').value).toBe('foo');
		expect(builder.add('Foo').value).toBe('foo-1');
		expect(builder.add('Foo').value).toBe('foo-2');
		expect(builder.add('Bar').value).toBe('bar');
	});
});

describe('githubSlugifier.fromFragment', () => {
	it('lowercases but does not strip punctuation', () => {
		expect(githubSlugifier.fromFragment('My-Header').value).toBe('my-header');
	});
});
