// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The opaque path space contract — see the header of `src/renderer/host.ts`.
 *
 *  Every case below runs three times, over three unrelated path spaces: a POSIX filesystem
 *  path, a Windows one, and the `/saf/<token>/…` virtual path an Android host will hand over.
 *  The renderer has to behave identically in all three, because it is not supposed to know
 *  which one it is looking at.
 *
 *  If one of these spaces ever needs a special case to pass, the contract is broken and a
 *  non-desktop host has lost its seam. That is the whole point of the file — it is a
 *  regression test for an architectural property, not for a function.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkdownItEngine } from '../../src/renderer/engine';
import { basename, dirname, resolvePath, samePath } from '../../src/renderer/paths';
import { getPlugins } from '../../src/renderer/plugins';
import { asLocalResourceUri } from '../../src/renderer/util';

interface PathSpace {
	readonly name: string;
	/** An absolute path to a document, as a host would emit it. */
	readonly doc: string;
	/** The document's own directory. */
	readonly dir: string;
	/** One level above it. */
	readonly parent: string;
	/** The opened folder, as `FolderPayload.root` would carry it. */
	readonly root: string;
}

const SPACES: readonly PathSpace[] = [
	{
		name: 'posix filesystem',
		doc: '/home/u/docs/file.md',
		dir: '/home/u/docs',
		parent: '/home/u',
		root: '/home/u/docs',
	},
	{
		name: 'windows filesystem',
		doc: 'C:/docs/file.md',
		dir: 'C:/docs',
		parent: 'C:',
		root: 'C:/docs',
	},
	{
		// What an Android host would pass: `<token>` names one picked SAF tree and
		// means nothing here.
		name: 'android saf virtual',
		doc: '/saf/tree-7/docs/file.md',
		dir: '/saf/tree-7/docs',
		parent: '/saf/tree-7',
		root: '/saf/tree-7',
	},
];

function render(text: string, context?: Parameters<MarkdownItEngine['render']>[1]) {
	return new MarkdownItEngine(getPlugins()).render(text, context);
}

/** The absolute path the engine recorded on a rendered link. */
function resolvedLinkPath(html: string): string | undefined {
	return /data-resolved-path="([^"]+)"/.exec(html)?.[1];
}

function imageSrc(html: string): string | undefined {
	// Lazy, and anchored on the leading space: the engine also emits `data-src` with the
	// unresolved original, and a greedy match lands on that instead.
	return /<img[^>]*?\ssrc="([^"]+)"/.exec(html)?.[1];
}

describe.each(SPACES)('$name', space => {
	describe('path arithmetic', () => {
		it('splits a document path into directory and name', () => {
			expect(dirname(space.doc)).toBe(space.dir);
			expect(basename(space.doc)).toBe('file.md');
		});

		it('names a child by appending a segment', () => {
			expect(resolvePath(space.dir, 'assets/x.svg')).toBe(`${space.dir}/assets/x.svg`);
		});

		it('removes the last segment for `..`', () => {
			expect(resolvePath(space.dir, '../img.png')).toBe(`${space.parent}/img.png`);
		});

		it('round-trips a path the host emitted', () => {
			expect(samePath(resolvePath(dirname(space.doc), basename(space.doc)), space.doc)).toBe(true);
		});
	});

	describe('reference resolution', () => {
		it('resolves a document-relative link against the document directory', () => {
			const { html } = render('[next](other.md)', { documentPath: space.doc });
			expect(resolvedLinkPath(html)).toBe(`${space.dir}/other.md`);
		});

		it('resolves a link that walks up out of the document directory', () => {
			const { html } = render('[up](../sibling.md)', { documentPath: space.doc });
			expect(resolvedLinkPath(html)).toBe(`${space.parent}/sibling.md`);
		});

		it('resolves a root-absolute reference against the opened folder', () => {
			const { html } = render('[top](/index.md)', {
				documentPath: space.doc,
				rootPath: space.root,
			});
			expect(resolvedLinkPath(html)).toBe(`${space.root}/index.md`);
		});

		it('resolves a relative image and hands it back through the resource origin', () => {
			const { html } = render('![alt](assets/badge.svg)', { documentPath: space.doc });
			expect(imageSrc(html)).toBe(asLocalResourceUri(`${space.dir}/assets/badge.svg`));
		});

		it('keeps a fragment out of the resolved path', () => {
			const { html } = render('[section](other.md#heading)', { documentPath: space.doc });
			expect(resolvedLinkPath(html)).toBe(`${space.dir}/other.md`);
		});

		it('leaves absolute URLs and data URIs alone', () => {
			const external = render('[out](https://example.com/x.md)', { documentPath: space.doc });
			expect(resolvedLinkPath(external.html)).toBeUndefined();

			const data = render('![px](data:image/png;base64,iVBORw0KGgo=)', { documentPath: space.doc });
			expect(imageSrc(data.html)).toBe('data:image/png;base64,iVBORw0KGgo=');
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  A static guard, on top of the behavioural cases above. Those prove today's code is
 *  host-agnostic; this one is what fails when someone reaches for `node:path` or a platform
 *  sniff while adding a feature, which is the realistic way the property gets lost.
 *--------------------------------------------------------------------------------------------*/

const RENDERER_DIR = nodePath.join(import.meta.dirname, '..', '..', 'src', 'renderer');

function rendererSources(): readonly { name: string; text: string }[] {
	return fs.readdirSync(RENDERER_DIR)
		.filter(name => name.endsWith('.ts'))
		.map(name => ({ name, text: fs.readFileSync(nodePath.join(RENDERER_DIR, name), 'utf8') }));
}

describe('renderer sources stay host-agnostic', () => {
	it('imports no filesystem or path module', () => {
		for (const { name, text } of rendererSources()) {
			expect.soft(text, `${name} imports a node module`)
				.not.toMatch(/from ['"](node:)?(path|fs|os|url)['"]/);
		}
	});

	it('reads no process globals', () => {
		// The renderer is browser code with two hosts; `process` means one of them was assumed.
		for (const { name, text } of rendererSources()) {
			expect.soft(text, `${name} reads a process global`).not.toMatch(/\bprocess\s*\./);
		}
	});

	it('sniffs the platform in exactly one place', () => {
		// `util.ts` picks the `mdr://` origin spelling WebView2 will accept. Item 6 adds a third
		// branch there for Android. It must stay the only such branch.
		const sniffing = rendererSources()
			.filter(({ text }) => /navigator\.(userAgent|platform)/.test(text))
			.map(({ name }) => name);
		expect(sniffing).toEqual(['util.ts']);
	});

	it('converts a `file:` URL to a path in exactly one place', () => {
		// The one documented exception to the contract; see the host.ts header. A second one
		// appearing is the signal that the exception is spreading.
		const converting = rendererSources()
			.filter(({ text }) => /\/\^file:/.test(text))
			.map(({ name }) => name);
		expect(converting).toEqual(['engine.ts']);
	});
});
