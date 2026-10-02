// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The files copied verbatim from VS Code, pinned byte for byte.
 *
 *  `licenses/NOTICE.md` records these as *Verbatim*, which is a deliberate design and not
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
 *  The upstream diff was last run against `microsoft/vscode` `main` at `57b4202903e`
 *  (2026-10-02): all of them are byte-identical to it, so the hashes below are upstream's own.
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
		bytes: 11460,
		sha256: '31acba626be3846f2a9b78421ce55e94feb5446d2b39bd06ab0453c0a010092d',
	},
	{
		path: 'src/renderer/css/highlight.css',
		origin: 'extensions/markdown-language-features/media/highlight.css',
		bytes: 3016,
		sha256: 'b73e0ecc7a5b91532f4359206f082b0d73a7d1f7bea68d8853a30385cf85c756',
	},
	{
		path: 'src/renderer/slugify.ts',
		origin: 'extensions/markdown-language-features/src/slugify.ts',
		bytes: 10719,
		sha256: 'ed95c6042911bc18463e1ceacce53abf3c252328dacaaa73c847f9cb0d752912',
	},
	{
		path: 'src/renderer/markdown-language-features/util/dom.ts',
		origin: 'extensions/markdown-language-features/src/util/dom.ts',
		bytes: 762,
		sha256: '500798e4e19fe1184de8fcb16ef4b9274a121a2e7d1a71e6c0c17068ce1a36a2',
	},
	{
		path: 'src/renderer/mermaid/vsCodeTheme.ts',
		origin: 'extensions/mermaid-markdown-features/preview-src/shared/vsCodeTheme.ts',
		bytes: 9523,
		sha256: 'ced57079d15522367bf8ddb45c2a1c59ddd777c6b9ba9c501b6ffce823441989',
	},
	{
		path: 'src/renderer/mermaid/config.ts',
		origin: 'extensions/mermaid-markdown-features/preview-src/shared/config.ts',
		bytes: 832,
		sha256: '46c436ad7731e91efbc3eb8e073e5201bd41f301edf3e543cf6614f9956d4fd4',
	},
	{
		path: 'src/renderer/mermaid/disposable.ts',
		origin: 'extensions/mermaid-markdown-features/preview-src/shared/disposable.ts',
		bytes: 403,
		sha256: '056d2662ea1c89d39041f9d56d52f7a573738d0a27ca9dde2e5b72aecef21bd8',
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

	it('carries a paint for every highlight the document registers', () => {
		// The bug this exists for: `document.ts` registered `mr-find-match`, and the only
		// `::highlight(mr-find-match)` rule was in `app.css` — so find highlighted on desktop and
		// painted nothing on Android, which vendors the document stylesheets and not the chrome
		// one. A custom highlight with no rule for its name is simply invisible: nothing throws,
		// and the feature reads as half-implemented rather than as a stylesheet in the wrong file.
		const documentModule = fs.readFileSync(
			path.join(REPO_ROOT, 'src/renderer/document.ts'), 'utf8',
		);
		const registered = [...documentModule.matchAll(/CSS\.highlights\.set\('([^']+)'/g)]
			.map(match => match[1]);

		expect(registered.length, 'nothing registers a highlight any more').toBeGreaterThan(0);

		const documentStyles = ['markdown.css', 'theme.css', 'document-overrides.css']
			.map(name => fs.readFileSync(path.join(REPO_ROOT, 'src/renderer/css', name), 'utf8'))
			.join('\n');

		for (const name of registered) {
			expect(
				documentStyles,
				`::highlight(${name}) is in no document stylesheet, so it paints nothing`,
			).toContain(`::highlight(${name})`);
		}
	});

	it('is copied into the build output', () => {
		// A stylesheet the page links but the build never copies 404s at runtime, which shows
		// up as unstyled output rather than an error.
		const build = fs.readFileSync(path.join(REPO_ROOT, 'build.mjs'), 'utf8');
		expect(build).toContain('document-overrides.css');
	});
});
