// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the scroll area (src/renderer/scroll.ts).
 *
 *  The window case must stay exactly what `DocumentView` did before it had a choice — the
 *  stub host and Android scroll the window. The element case is the one with arithmetic in
 *  it: client coordinates are measured from the viewport, and the reading line is measured
 *  from the element's own top edge, so a scroller below a toolbar has to subtract its offset.
 *  jsdom does no layout, so the geometry is stubbed.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { scrollAreaOf } from '../../src/renderer/scroll';

describe('the window', () => {
	it('measures from the viewport, as getBoundingClientRect already does', () => {
		expect(scrollAreaOf(undefined).fromTop(90)).toBe(90);
	});

	it('scrolls the window, passing a behaviour only when one is asked for', () => {
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		const area = scrollAreaOf(undefined);
		area.scrollTo(120);
		area.scrollTo(300, 'smooth');
		expect(scrollTo.mock.calls).toEqual([[{ top: 120 }], [{ top: 300, behavior: 'smooth' }]]);
		scrollTo.mockRestore();
	});
});

describe('an element', () => {
	/** A scroller whose visible top edge is at `top + border` in client space. */
	function scroller(top: number, border = 0): HTMLElement {
		const element = document.createElement('div');
		element.getBoundingClientRect = () => ({ top } as DOMRect);
		Object.defineProperty(element, 'clientTop', { value: border });
		Object.defineProperty(element, 'clientHeight', { value: 600 });
		element.scrollTo = vi.fn() as unknown as typeof element.scrollTo;
		document.body.appendChild(element);
		return element;
	}

	it('measures from its own top edge, not the viewport', () => {
		// 38px below the viewport top, as the desktop toolbar puts it.
		expect(scrollAreaOf(scroller(38)).fromTop(128)).toBe(90);
	});

	it('does not count its border as visible', () => {
		expect(scrollAreaOf(scroller(38, 2)).fromTop(128)).toBe(88);
	});

	it('reads and moves its own scroll offset, not the window', () => {
		const element = scroller(38);
		element.scrollTop = 250;
		const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

		const area = scrollAreaOf(element);
		expect(area.scrollTop).toBe(250);
		expect(area.height).toBe(600);
		area.scrollTo(40);
		area.scrollTo(80, 'smooth');

		expect(element.scrollTo).toHaveBeenCalledWith({ top: 40 });
		expect(element.scrollTo).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' });
		expect(windowScroll).not.toHaveBeenCalled();
		windowScroll.mockRestore();
	});

	it('hears its own scroll events, not the window', () => {
		const element = scroller(0);
		const listener = vi.fn();
		scrollAreaOf(element).onScroll(listener);

		window.dispatchEvent(new Event('scroll'));
		expect(listener).not.toHaveBeenCalled();
		element.dispatchEvent(new Event('scroll'));
		expect(listener).toHaveBeenCalledOnce();
	});
});
