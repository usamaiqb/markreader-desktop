// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the escaping and resource-URI helpers (src/renderer/util.ts).
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { escapeAttribute, escapeHtml } from '../../src/renderer/markdown-language-features/util/dom';
import {
	asLocalResourceUri,
	isAbsolutePath,
	localResourceUriToPath,
} from '../../src/renderer/util';

describe('escapeHtml', () => {
	it('escapes the five markup characters', () => {
		expect(escapeHtml(`<a href="x" & 'y'>`)).toBe(
			'&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;',
		);
	});

	it('leaves plain text alone', () => {
		expect(escapeHtml('plain text 123')).toBe('plain text 123');
	});
});

describe('escapeAttribute', () => {
	it('escapes double quotes', () => {
		expect(escapeAttribute('say "hi"')).toBe('say &quot;hi&quot;');
	});
});

describe('isAbsolutePath', () => {
	it('accepts posix and windows absolute paths', () => {
		expect(isAbsolutePath('/a/b')).toBe(true);
		expect(isAbsolutePath('C:/a/b')).toBe(true);
		expect(isAbsolutePath('C:\\a\\b')).toBe(true);
	});

	it('rejects relative paths', () => {
		expect(isAbsolutePath('a/b')).toBe(false);
		expect(isAbsolutePath('./a')).toBe(false);
	});
});

describe('mdr:// resource URIs', () => {
	it('normalizes backslashes and encodes each segment', () => {
		const uri = asLocalResourceUri('C:\\docs\\a b.md');
		expect(uri).toMatch(/(^mdr:\/\/localhost|\/\/mdr\.localhost)\/C%3A\/docs\/a%20b\.md$/);
	});

	it('round-trips a windows path', () => {
		const uri = asLocalResourceUri('C:/docs/a b.md');
		expect(localResourceUriToPath(uri)).toBe('C:/docs/a b.md');
	});

	it('round-trips a posix path', () => {
		const uri = asLocalResourceUri('/home/user/a.md');
		expect(localResourceUriToPath(uri)).toBe('/home/user/a.md');
	});

	it('returns undefined for a foreign origin', () => {
		expect(localResourceUriToPath('https://example.com/x.md')).toBeUndefined();
	});
});
