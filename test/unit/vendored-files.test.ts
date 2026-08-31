// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The files copied verbatim from VS Code, pinned byte for byte.
 *
 *  `licenses/NOTICE.md` records these three as *Verbatim*, which is a deliberate design and not
 *  a formality: local deviation is quarantined in files we own, so the copies stay diffable
 *  against the vscode repo when upstream moves. Editing one in place to fix RTL or add a media
 *  query would destroy that silently, and nothing would notice for months.
 *
 *  So this fails loudly instead. **If it fails because you edited one of these files, the edit
 *  belongs in `src/renderer/css/document-overrides.css`** — that is what the file is for. If it
 *  fails because you deliberately re-synced with a newer upstream, update the hash here and say
 *  which vscode revision it came from.
 *
 *  What this proves and does not: it proves nothing has changed since these hashes were taken.
 *  It cannot prove the copy matches upstream — that needs the vscode repo, and is the manual
 *  step the NOTICE describes. Byte-identity is what makes that manual diff a one-liner.
 *
 *  That distinction is not academic, and it has already caught something. These hashes were
 *  once taken over a `markdown.css` that had had 44 lines of front-matter rules moved out of
 *  it, on the belief they were MarkReader's own. **They are upstream's** — VS Code ships a
 *  `yamlPreamble` extension — so the move left this file 44 lines short of the copy it exists
 *  to be, and the hash would have pinned that divergence indefinitely. The block is restored,
 *  and the three properties that genuinely deviate are logical-property overrides in
 *  `document-overrides.css`.
 *
 *  The upstream diff has since been run against `microsoft/vscode` `main`: both stylesheets
 *  match it exactly, apart from the single `Ported verbatim from …` marker line each carries.
 *
 *  Raw bytes are hashed rather than normalized text, which `.gitattributes` makes safe: it
 *  pins `eol=lf` for exactly these files, since a Windows clone would otherwise get CRLF and
 *  break byte-comparison against upstream regardless of what this test did.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '..', '..');

interface VendoredFile {
	/** Repo-relative path. */
	readonly path: string;
	/** Where it came from in the vscode repo, as recorded in licenses/NOTICE.md. */
	readonly origin: string;
	readonly bytes: number;
	readonly sha256: string;
}

const VENDORED: readonly VendoredFile[] = [
	{
		path: 'src/renderer/css/markdown.css',
		origin: 'extensions/markdown-language-features/media/markdown.css',
		bytes: 11551,
		sha256: '9c7fc4016a05a953820e7dd83506cecc31c610a19d137142f21b10bed7c0ff2a',
	},
	{
		path: 'src/renderer/css/highlight.css',
		origin: 'extensions/markdown-language-features/media/highlight.css',
		bytes: 3108,
		sha256: '427a82c14e421dbbfa6c595f5623ce25579424f203b6506a1dac4bcd13ad719b',
	},
	{
		path: 'src/renderer/slugify.ts',
		origin: 'extensions/markdown-language-features/src/slugify.ts',
		bytes: 11010,
		sha256: '6642bd6ec3204917e2f5896e366d41d570abef8e87da2dc4c7f20447edb9b109',
	},
];

describe.each(VENDORED)('$path', file => {
	const contents = fs.readFileSync(path.join(REPO_ROOT, file.path));

	it(`is unchanged from ${file.origin}`, () => {
		expect(createHash('sha256').update(contents).digest('hex')).toBe(file.sha256);
	});

	it('has the size it was copied at', () => {
		// Redundant with the hash, but it turns "some byte differs" into "the file grew by 40
		// bytes", which is usually enough to see what happened.
		expect(contents.length).toBe(file.bytes);
	});

	it('has no CRLF line endings', () => {
		// The failure .gitattributes exists to prevent. Asserted separately so a checkout
		// problem does not read as an edit.
		expect(contents.toString('utf8')).not.toMatch(/\r\n/);
	});
});

describe('the overrides file that exists so those stay untouched', () => {
	it('is loaded by the host page, after the stylesheets it overrides', () => {
		const html = fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/index.html'), 'utf8');
		const order = ['css/markdown.css', 'css/highlight.css', 'css/document-overrides.css'];
		const positions = order.map(href => html.indexOf(href));

		expect(positions.every(at => at !== -1), 'a document stylesheet is not linked').toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it('is copied into the build output', () => {
		// A stylesheet the page links but the build never copies 404s at runtime, which shows
		// up as unstyled output rather than an error.
		const build = fs.readFileSync(path.join(REPO_ROOT, 'build.mjs'), 'utf8');
		expect(build).toContain('document-overrides.css');
	});
});
