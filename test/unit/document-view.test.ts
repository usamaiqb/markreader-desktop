// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for DocumentView (src/renderer/document.ts) — the parts that decide where it
 *  looks and where it scrolls.
 *
 *  Two rules from the top of document.ts, checked directly: the view finds headings inside its
 *  own root and nowhere else on the page, and with a scroller it scrolls that rather than the
 *  window. jsdom does no layout, so every rectangle is zero and only the routing is tested
 *  here; the arithmetic is in scroll.test.ts.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentView } from '../../src/renderer/document';
import type { DocumentHost } from '../../src/renderer/host';

const host: DocumentHost = {
	openExternal: async () => {},
	openPath: async () => {},
	readFile: async () => undefined,
};

const TEXT = '# 1. Intro\n\nFirst.\n\n## Über\n\nSecond.\n';

interface Fixture {
	view: DocumentView;
	root: HTMLElement;
	scroller: HTMLElement;
	scrollTo: ReturnType<typeof vi.fn>;
}

function fixture(): Fixture {
	// Same ids as the document will generate, outside the root: what another view, or the
	// shell, could put on the page. A page-wide lookup finds these first.
	document.body.innerHTML = `
		<h1 id="1-intro" class="decoy">decoy</h1>
		<h2 id="über" class="decoy">decoy</h2>
		<div id="viewer"><div id="markdown-body"></div></div>`;
	const root = document.getElementById('markdown-body')!;
	const scroller = document.getElementById('viewer')!;
	const scrollTo = vi.fn();
	scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
	return { view: new DocumentView({ root, host, scroller }), root, scroller, scrollTo };
}

/** Renders `TEXT` and waits for the frame in which the view restores a scroll position. */
async function show(view: DocumentView, options: Parameters<DocumentView['setDocument']>[1]): Promise<void> {
	const rendered = new Promise<void>(resolve => {
		const off = view.on('headings', headings => {
			if (headings.length) {
				off();
				resolve();
			}
		});
	});
	view.setDocument({ path: '/docs/a.md', text: TEXT }, options);
	await rendered;
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

beforeEach(() => {
	// jsdom has no matchMedia; DocumentView reads the system colour scheme from it.
	window.matchMedia = (() => ({ matches: false, addEventListener() {} })) as unknown as typeof window.matchMedia;
});

describe('heading lookups stay inside the root', () => {
	it('reveals the heading in the document, not a same-id element elsewhere', async () => {
		const { view, root } = fixture();
		await show(view, { preserveScroll: false });
		// Not a valid selector as written: an id may not start with a digit unescaped.
		expect(root.querySelector('h1')!.id).toBe('1-intro');

		view.revealSlug('1-intro');

		expect(root.querySelector('h1')!.classList.contains('mr-target-flash')).toBe(true);
		expect(document.querySelector('h1.decoy')!.classList.contains('mr-target-flash')).toBe(false);
	});

	it('falls back to the decoded fragment, still inside the root', async () => {
		const { view, root } = fixture();
		await show(view, { preserveScroll: false });

		view.revealSlug(encodeURIComponent('über'));

		expect(root.querySelector('h2')!.classList.contains('mr-target-flash')).toBe(true);
		expect(document.querySelector('h2.decoy')!.classList.contains('mr-target-flash')).toBe(false);
	});

	it('ignores a slug the document does not have', async () => {
		const { view, scrollTo } = fixture();
		await show(view, { preserveScroll: false });
		scrollTo.mockClear();

		view.revealSlug('nowhere');

		expect(scrollTo).not.toHaveBeenCalled();
	});
});

describe('scrolling goes to the scroller', () => {
	it('reveals by scrolling the scroller, never the window', async () => {
		const { view, scrollTo } = fixture();
		const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		await show(view, { preserveScroll: false });

		view.revealSlug('1-intro');

		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
		expect(windowScroll).not.toHaveBeenCalled();
		windowScroll.mockRestore();
	});

	it('reports the scroller’s offset as its view state', () => {
		const { view, scroller } = fixture();
		scroller.scrollTop = 420;
		expect(view.getViewState()).toEqual({ scrollTop: 420 });
	});

	it('restores a view state it is handed', async () => {
		const { view, scrollTo } = fixture();
		await show(view, { preserveScroll: false, viewState: { scrollTop: 321 } });
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 321 });
	});

	it('starts a document it has never shown at the top', async () => {
		const { view, scrollTo } = fixture();
		await show(view, { preserveScroll: false });
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });
	});
});
