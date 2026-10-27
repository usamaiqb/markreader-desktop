// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The tab strip: draws a `TabsModel` and turns clicks on it back into calls on the model.
 *
 *  It holds no state of its own — `render()` rebuilds the strip from the model, which is cheap
 *  at the number of tabs a reader has open and leaves nothing to fall out of step. The shell
 *  calls it on every model change.
 *--------------------------------------------------------------------------------------------*/

import { escapeHtml } from '../markdown-language-features/util/dom';
import { basename, dirname } from '../paths';
import type { Tab, TabsModel } from './model';

export interface TabStrip {
	render(): void;
}

export function createTabStrip(container: HTMLElement, model: TabsModel): TabStrip {
	container.setAttribute('role', 'tablist');

	const tabOf = (target: EventTarget | null): Tab | undefined => {
		const element = (target as HTMLElement | null)?.closest<HTMLElement>('.tab');
		return element ? model.get(Number(element.dataset.id)) : undefined;
	};

	container.addEventListener('click', event => {
		const tab = tabOf(event.target);
		if (!tab) {
			return;
		}
		if ((event.target as HTMLElement).closest('.tab-close')) {
			model.close(tab.id);
		} else {
			model.activate(tab.id);
		}
	});

	// Middle click closes, as it does in VS Code and every browser.
	container.addEventListener('auxclick', event => {
		const tab = event.button === 1 ? tabOf(event.target) : undefined;
		if (tab) {
			event.preventDefault();
			model.close(tab.id);
		}
	});
	// Or the middle button's autoscroll would start on the way to the `auxclick`.
	container.addEventListener('mousedown', event => {
		if (event.button === 1) {
			event.preventDefault();
		}
	});

	container.addEventListener('dblclick', event => {
		const tab = tabOf(event.target);
		if (tab && !(event.target as HTMLElement).closest('.tab-close')) {
			model.pin(tab.id);
		}
	});

	// The strip only scrolls sideways, and most mice only scroll up and down.
	container.addEventListener('wheel', event => {
		if (event.deltaY && !event.deltaX) {
			container.scrollLeft += event.deltaY;
			event.preventDefault();
		}
	}, { passive: false });

	function render(): void {
		const tabs = model.tabs;
		const active = model.active;
		const names = countNames(tabs);

		container.innerHTML = '';
		for (const tab of tabs) {
			const name = basename(tab.path);
			// Two `README.md`s say which folder each is in, as VS Code's labels do.
			const dir = (names.get(name.toLowerCase()) ?? 0) > 1 ? basename(dirname(tab.path)) : '';

			const element = document.createElement('div');
			element.className = 'tab';
			element.classList.toggle('active', tab === active);
			element.classList.toggle('preview', tab.preview);
			element.dataset.id = String(tab.id);
			element.setAttribute('role', 'tab');
			element.setAttribute('aria-selected', String(tab === active));
			element.title = tab.preview ? `${tab.path}\nPreview: double-click to keep it open` : tab.path;
			element.innerHTML =
				`<span class="tab-label">${escapeHtml(name)}${dir ? `<span class="tab-dir">${escapeHtml(dir)}</span>` : ''}</span>`
				+ '<button class="tab-close" title="Close (Ctrl+W)" aria-label="Close">'
				+ '<svg class="mr-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>'
				+ '</button>';
			container.appendChild(element);
		}

		container.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	return { render };
}

function countNames(tabs: readonly Tab[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const tab of tabs) {
		const name = basename(tab.path).toLowerCase();
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return counts;
}
