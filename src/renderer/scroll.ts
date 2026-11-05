// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  What a `DocumentView` scrolls: the window, or an element the host hands it.
 *
 *  The document's scroll maths — the reading line, reveal headroom, centring a find match —
 *  is all "how far below the top of what the reader can see". With the window that top is
 *  the viewport's, which `getBoundingClientRect()` already measures from. With an element it
 *  is the element's own top edge, which is not. This is the one place that difference lives.
 *
 *  Either way, a host may draw chrome over the top of the area rather than above it — Android
 *  lays its status bar and top bar over an edge-to-edge WebView. `coveredTop` says how much,
 *  and everything here is measured from below it.
 *--------------------------------------------------------------------------------------------*/

export interface ScrollArea {
	/** How far the content is scrolled from its top. */
	readonly scrollTop: number;
	/** The height of the visible part, not counting what `coveredTop` covers. */
	readonly height: number;
	/** A client-space `y` (as from `getBoundingClientRect()`), measured from the visible top. */
	fromTop(clientY: number): number;
	/** Omitting `behavior` leaves it to CSS `scroll-behavior`, as a bare `scrollTo` does. */
	scrollTo(top: number, behavior?: ScrollBehavior): void;
	onScroll(listener: () => void): void;
	/**
	 * CSS px at the top of the area that the host draws over. 0 unless the host says otherwise;
	 * anything negative or not finite is taken as 0.
	 */
	coveredTop: number;
}

/** The window when `element` is absent, which is what a host without a scroll container gets. */
export function scrollAreaOf(element: HTMLElement | undefined, win: Window = window): ScrollArea {
	const target: HTMLElement | Window = element ?? win;
	// The padding box is what scrolls, so the border is not part of the visible area.
	const edge = element ? () => element.getBoundingClientRect().top + element.clientTop : () => 0;
	const extent = element ? () => element.clientHeight : () => win.innerHeight;
	let covered = 0;

	return {
		get scrollTop() { return element ? element.scrollTop : win.scrollY; },
		get height() { return Math.max(0, extent() - covered); },
		fromTop: clientY => clientY - edge() - covered,
		scrollTo: (top, behavior) => target.scrollTo(behavior ? { top, behavior } : { top }),
		onScroll: listener => target.addEventListener('scroll', listener, { passive: true }),
		get coveredTop() { return covered; },
		set coveredTop(px: number) { covered = Number.isFinite(px) && px > 0 ? px : 0; },
	};
}
