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
import { DocumentView, type FindState } from '../../src/renderer/document';
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

describe('a covered top', () => {
	/** Puts the rendered headings at these client-space tops; the scroller's own top is 0. */
	function place(root: HTMLElement, tops: readonly number[]): void {
		for (const [i, heading] of root.querySelectorAll('h1, h2').entries()) {
			heading.getBoundingClientRect = () => ({ top: tops[i] } as DOMRect);
		}
	}

	it('moves the reading line below it, without waiting for a scroll', async () => {
		const { view, root } = fixture();
		await show(view, { preserveScroll: false });
		// The second heading sits just below a 115px bar: in plain view, but past a reading line
		// measured from the very top.
		place(root, [-200, 150]);
		// Rendering saw jsdom's all-zero layout; settle on the placed one first.
		view.setCoveredTop(0);
		const active: (string | undefined)[] = [];
		view.on('activeHeading', slug => active.push(slug));

		view.setCoveredTop(115);
		view.setCoveredTop(0);

		expect(active).toEqual(['über', '1-intro']);
	});

	it('leaves the reveal headroom below it', async () => {
		const { view, root, scrollTo } = fixture();
		await show(view, { preserveScroll: false });
		place(root, [400, 900]);

		view.revealSlug('1-intro');
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 382, behavior: 'smooth' });

		view.setCoveredTop(115);
		view.revealSlug('1-intro');
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 267, behavior: 'smooth' });
	});
});

describe('a restore still waiting for its frame', () => {
	/** Animation frames run only when `flush` is called, so a reload can land before one. */
	function holdFrames(): { flush: () => void; restore: () => void } {
		const frames: FrameRequestCallback[] = [];
		const spy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
			frames.push(callback);
			return frames.length;
		});
		return {
			flush: () => {
				while (frames.length) {
					frames.shift()!(0);
				}
			},
			restore: () => spy.mockRestore(),
		};
	}

	/** Resolves once `view` has rendered a document with headings. */
	function rendered(view: DocumentView): Promise<void> {
		return new Promise(resolve => {
			const off = view.on('headings', headings => {
				if (headings.length) {
					off();
					resolve();
				}
			});
		});
	}

	const A = { path: '/docs/a.md', text: TEXT };
	const B = { path: '/docs/b.md', text: TEXT };

	it('is kept by a live reload that lands first', async () => {
		const { view, scrollTo } = fixture();
		const frames = holdFrames();

		let done = rendered(view);
		view.setDocument(A, { preserveScroll: false, viewState: { scrollTop: 300 } });
		await done;
		// The file changed on disk before the restore's frame: the scroller still reads 0.
		done = rendered(view);
		view.setDocument(A, { preserveScroll: true });
		await done;
		frames.flush();
		frames.restore();

		expect(scrollTo.mock.calls).toEqual([[{ top: 300 }]]);
	});

	it('is what the view state reports', async () => {
		const { view } = fixture();
		const frames = holdFrames();

		const done = rendered(view);
		view.setDocument(A, { preserveScroll: false, viewState: { scrollTop: 300 } });
		await done;
		expect(view.getViewState()).toEqual({ scrollTop: 300 });
		frames.restore();
	});

	it('is what is remembered when another document replaces it first', async () => {
		const { view, scrollTo } = fixture();
		const frames = holdFrames();

		let done = rendered(view);
		view.setDocument(A, { preserveScroll: false, viewState: { scrollTop: 300 } });
		await done;
		done = rendered(view);
		view.setDocument(B, { preserveScroll: false });
		await done;
		frames.flush();
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });

		done = rendered(view);
		view.setDocument(A, { preserveScroll: false });
		await done;
		frames.flush();
		frames.restore();

		expect(scrollTo).toHaveBeenLastCalledWith({ top: 300 });
	});
});

describe('find', () => {
	/**
	 * jsdom has no CSS Custom Highlight API, and no layout for revealing a match: a `Set` per
	 * highlight and an all-zero rectangle are all the view needs.
	 */
	function withHighlights(): { registry: Map<string, Set<AbstractRange>>; restore: () => void } {
		const registry = new Map<string, Set<AbstractRange>>();
		const globals = globalThis as unknown as { Highlight?: unknown };
		const css = CSS as unknown as { highlights?: unknown };
		globals.Highlight = class extends Set<AbstractRange> {};
		css.highlights = registry;
		const range = Range.prototype as Partial<Range>;
		range.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
		return {
			registry,
			restore: () => {
				delete globals.Highlight;
				delete css.highlights;
				delete range.getBoundingClientRect;
			},
		};
	}

	async function showText(view: DocumentView, text: string): Promise<void> {
		const rendered = new Promise<void>(resolve => {
			const off = view.on('headings', headings => {
				if (headings.length) {
					off();
					resolve();
				}
			});
		});
		view.setDocument({ path: '/docs/find.md', text: `# Find\n\n${text}\n` }, { preserveScroll: false });
		await rendered;
	}

	it('paints a match count too large to spread into one call', async () => {
		const { view } = fixture();
		const { registry, restore } = withHighlights();
		// Enough matches that `new Highlight(...matches)` overflows the stack.
		await showText(view, 's '.repeat(200_000));
		const states: FindState[] = [];
		view.on('find', state => states.push(state));

		expect(() => view.runFind('s')).not.toThrow();

		expect(states.at(-1)).toMatchObject({ index: 0, total: 200_000 });
		expect(registry.get('mr-find-current')?.size).toBe(1);
		expect(registry.get('mr-find-match')?.size).toBe(199_999);
		restore();
	});

	it('moves only the current match between the highlights on a step', async () => {
		const { view } = fixture();
		const { registry, restore } = withHighlights();
		await showText(view, 'one two one three one');
		view.runFind('one');
		const others = registry.get('mr-find-match')!;
		const current = registry.get('mr-find-current')!;
		const [first] = current;

		view.stepFind(1);

		// The same registered highlights, updated in place rather than rebuilt.
		expect(registry.get('mr-find-match')).toBe(others);
		expect(registry.get('mr-find-current')).toBe(current);
		expect(current.size).toBe(1);
		expect(current.has(first)).toBe(false);
		expect(others.has(first)).toBe(true);
		expect(others.size).toBe(2);

		view.stepFind(-1);
		expect([...current]).toEqual([first]);
		restore();
	});
});
