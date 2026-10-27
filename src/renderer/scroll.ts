// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  What a `DocumentView` scrolls: the window, or an element the host hands it.
 *
 *  The document's scroll maths — the reading line, reveal headroom, centring a find match —
 *  is all "how far below the top of what the reader can see". With the window that top is
 *  the viewport's, which `getBoundingClientRect()` already measures from. With an element it
 *  is the element's own top edge, which is not. This is the one place that difference lives.
 *--------------------------------------------------------------------------------------------*/

export interface ScrollArea {
	/** How far the content is scrolled from its top. */
	readonly scrollTop: number;
	/** The height of the visible part. */
	readonly height: number;
	/** A client-space `y` (as from `getBoundingClientRect()`), measured from the visible top. */
	fromTop(clientY: number): number;
	/** Omitting `behavior` leaves it to CSS `scroll-behavior`, as a bare `scrollTo` does. */
	scrollTo(top: number, behavior?: ScrollBehavior): void;
	onScroll(listener: () => void): void;
}

/** The window when `element` is absent, which is what a host without a scroll container gets. */
export function scrollAreaOf(element: HTMLElement | undefined, win: Window = window): ScrollArea {
	if (!element) {
		return {
			get scrollTop() { return win.scrollY; },
			get height() { return win.innerHeight; },
			fromTop: clientY => clientY,
			scrollTo: (top, behavior) => win.scrollTo(behavior ? { top, behavior } : { top }),
			onScroll: listener => win.addEventListener('scroll', listener, { passive: true }),
		};
	}
	return {
		get scrollTop() { return element.scrollTop; },
		get height() { return element.clientHeight; },
		// The padding box is what scrolls, so the border is not part of the visible area.
		fromTop: clientY => clientY - element.getBoundingClientRect().top - element.clientTop,
		scrollTo: (top, behavior) => element.scrollTo(behavior ? { top, behavior } : { top }),
		onScroll: listener => element.addEventListener('scroll', listener, { passive: true }),
	};
}
