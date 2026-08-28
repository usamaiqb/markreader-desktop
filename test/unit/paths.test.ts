// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the renderer path helpers (src/renderer/paths.ts).
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { basename, dirname, extname, isMarkdownPath, resolvePath } from '../../src/renderer/paths';

describe('dirname', () => {
	it('handles forward slashes', () => {
		expect(dirname('/a/b/c.md')).toBe('/a/b');
	});

	it('normalizes backslashes', () => {
		expect(dirname('C:\\a\\b\\c.md')).toBe('C:/a/b');
	});

	it('returns the root for a top-level file', () => {
		expect(dirname('/a.md')).toBe('/');
	});
});

describe('basename', () => {
	it('strips the directory portion', () => {
		expect(basename('/a/b/c.md')).toBe('c.md');
		expect(basename('C:\\a\\b\\c.md')).toBe('c.md');
	});
});

describe('extname', () => {
	it('returns the extension including the dot', () => {
		expect(extname('/a/b.md')).toBe('.md');
	});

	it('returns empty when there is no extension', () => {
		expect(extname('/a/README')).toBe('');
	});

	it('does not mistake a dotfile for an extension', () => {
		expect(extname('/a/.env')).toBe('');
	});
});

describe('resolvePath', () => {
	it('joins relative segments', () => {
		expect(resolvePath('/a/b', 'c.md')).toBe('/a/b/c.md');
	});

	it('collapses dot segments', () => {
		expect(resolvePath('/a/b/c', '../d.md')).toBe('/a/b/d.md');
	});

	it('clamps parent escapes at the root', () => {
		expect(resolvePath('/a', '../../x.md')).toBe('/x.md');
	});

	it('keeps the windows drive letter', () => {
		expect(resolvePath('C:/a/b', 'c.md')).toBe('C:/a/b/c.md');
	});

	it('treats a leading slash on the relative part as plain path', () => {
		expect(resolvePath('/a/b', '/c.md')).toBe('/a/b/c.md');
	});
});

describe('isMarkdownPath', () => {
	it('accepts markdown extensions case-insensitively', () => {
		expect(isMarkdownPath('x.md')).toBe(true);
		expect(isMarkdownPath('x.MD')).toBe(true);
		expect(isMarkdownPath('x.markdown')).toBe(true);
		expect(isMarkdownPath('/a/b/x.mkd')).toBe(true);
	});

	it('rejects everything else', () => {
		expect(isMarkdownPath('x.txt')).toBe(false);
		expect(isMarkdownPath('x')).toBe(false);
	});
});
