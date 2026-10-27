// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The open tabs of one window — order, the active tab, preview vs pinned, and the history
 *  that closing and reopening work from.
 *
 *  Modelled on VS Code's `EditorGroupModel` (workbench/common/editor/editorGroupModel.ts), cut
 *  down to what a reader needs: no sticky tabs, no dirty state, no groups. A tab here is the
 *  cheap half of VS Code's split — what is open and how it was left — and holds no DOM and
 *  no document text. The view that draws it is shared between tabs and swapped as they are
 *  activated, the way one `EditorPane` serves every input of its type.
 *
 *  Pure on purpose: no DOM, no host, so it is unit tested headless (test/unit/tabs-model.test.ts)
 *  and the shell is left only the wiring.
 *--------------------------------------------------------------------------------------------*/

import { samePath } from '../paths';

/** Which viewer draws a tab. Only markdown exists today; the field is here so that others can. */
export type ViewerId = string;

export const DEFAULT_VIEWER: ViewerId = 'markdown';

export interface Tab {
	/** Stable for the tab's lifetime, and never reused within a model. */
	readonly id: number;
	readonly path: string;
	readonly viewerId: ViewerId;
	/**
	 * A preview tab is replaced by the next preview opened, rather than joined by it — so
	 * browsing the sidebar or following links does not leave a tab behind for every stop.
	 * Pinning it (double-click, or opening it deliberately) keeps it.
	 */
	readonly preview: boolean;
	/** Whatever the viewer handed back when the tab was last left. Opaque to the model. */
	readonly viewState: unknown;
}

export interface OpenOptions {
	readonly viewerId?: ViewerId;
	/** Default `pinned`. */
	readonly mode?: 'preview' | 'pinned';
	/**
	 * Open without activating — Ctrl+click on a link. Ignored when nothing is active, since a
	 * window with tabs and none showing is not a state the shell can draw.
	 */
	readonly background?: boolean;
	/** Restored into the tab when it is created; an already open tab keeps its own. */
	readonly viewState?: unknown;
}

export interface TabsChange {
	/** The active tab is a different one, or there is none: the view has to be given it. */
	readonly activeChanged: boolean;
}

/** What `serialize()` writes and `restore()` reads. Versioned, since it outlives a release. */
export interface SerializedTabs {
	readonly version: 1;
	readonly tabs: readonly {
		readonly path: string;
		readonly viewerId: ViewerId;
		readonly preview: boolean;
		readonly viewState?: unknown;
	}[];
	/** Index into `tabs`, or -1 for none. */
	readonly active: number;
}

/** How many closed tabs Ctrl+Shift+T can bring back. */
const CLOSED_HISTORY = 20;

interface ClosedTab {
	readonly path: string;
	readonly viewerId: ViewerId;
	readonly viewState: unknown;
	readonly index: number;
}

export class TabsModel {
	private list: Tab[] = [];
	private activeId: number | undefined;
	/** Tab ids, most recently active first. What closing the active tab falls back along. */
	private mru: number[] = [];
	/** Most recently closed last. */
	private closed: ClosedTab[] = [];
	private nextId = 1;

	private readonly listeners = new Set<(change: TabsChange) => void>();

	// ------------------------------------------------------------------------- events

	onChange(listener: (change: TabsChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(previousActive: number | undefined): void {
		const change: TabsChange = { activeChanged: previousActive !== this.activeId };
		for (const listener of this.listeners) {
			listener(change);
		}
	}

	// -------------------------------------------------------------------------- state

	get tabs(): readonly Tab[] {
		return this.list;
	}

	get active(): Tab | undefined {
		return this.activeId === undefined ? undefined : this.get(this.activeId);
	}

	/** Most recently active first, the active tab included. */
	get recent(): readonly Tab[] {
		return this.mru.map(id => this.get(id)!);
	}

	get(id: number): Tab | undefined {
		return this.list.find(tab => tab.id === id);
	}

	/** The tab showing `path`, if one is — compared as the rest of the renderer compares paths. */
	find(path: string): Tab | undefined {
		return this.list.find(tab => samePath(tab.path, path));
	}

	// ------------------------------------------------------------------------ opening

	/**
	 * Opens `path`, or activates it if a tab already shows it: a file is never open twice.
	 *
	 * A new tab goes to the right of the active one, as VS Code's default `openPositioning`
	 * does — beside the document it was reached from, rather than at the far end of the strip.
	 * A new preview tab takes the existing preview tab's place instead, wherever that is.
	 */
	open(path: string, options: OpenOptions = {}): Tab {
		const previousActive = this.activeId;
		const preview = options.mode === 'preview';
		const activate = !options.background || this.activeId === undefined;

		const existing = this.find(path);
		if (existing) {
			if (!preview && existing.preview) {
				this.replace(existing, { ...existing, preview: false });
			}
			if (activate) {
				this.setActive(existing.id);
			}
			this.emit(previousActive);
			return this.get(existing.id)!;
		}

		const tab: Tab = {
			id: this.nextId++,
			path,
			viewerId: options.viewerId ?? DEFAULT_VIEWER,
			preview,
			viewState: options.viewState,
		};

		const previewTab = preview ? this.list.find(t => t.preview) : undefined;
		if (previewTab) {
			const index = this.list.indexOf(previewTab);
			this.list.splice(index, 1, tab);
			this.mru = this.mru.filter(id => id !== previewTab.id);
			if (this.activeId === previewTab.id) {
				this.activeId = undefined;
			}
		} else {
			const activeIndex = this.activeId === undefined ? -1 : this.indexOf(this.activeId);
			const index = activeIndex === -1 ? this.list.length : activeIndex + 1;
			this.list.splice(index, 0, tab);
		}

		if (activate || this.activeId === undefined) {
			this.setActive(tab.id);
		} else {
			// Behind the active tab, so Ctrl+Tab reaches a background tab first.
			this.mru.splice(1, 0, tab.id);
		}

		this.emit(previousActive);
		return tab;
	}

	/** Keeps a preview tab, so the next preview opens beside it rather than over it. */
	pin(id: number): void {
		const tab = this.get(id);
		if (!tab?.preview) {
			return;
		}
		this.replace(tab, { ...tab, preview: false });
		this.emit(this.activeId);
	}

	// --------------------------------------------------------------------- activation

	activate(id: number): void {
		if (!this.get(id) || id === this.activeId) {
			return;
		}
		const previousActive = this.activeId;
		this.setActive(id);
		this.emit(previousActive);
	}

	/** Ctrl+PgDn / Ctrl+PgUp: by position, wrapping at either end. */
	activateRelative(delta: number): void {
		if (this.activeId === undefined || this.list.length < 2) {
			return;
		}
		const count = this.list.length;
		const index = (((this.indexOf(this.activeId) + delta) % count) + count) % count;
		this.activate(this.list[index].id);
	}

	/**
	 * Ctrl+1 … Ctrl+9, 0-based. As in VS Code and browsers, 8 (Ctrl+9) is always the last tab
	 * however many there are.
	 */
	activateIndex(index: number): void {
		const tab = index === 8 ? this.list.at(-1) : this.list[index];
		if (tab) {
			this.activate(tab.id);
		}
	}

	// ------------------------------------------------------------------------ closing

	/**
	 * Closes a tab. If it was the active one, the tab used before it becomes active — not its
	 * neighbour, which is VS Code's default `focusRecentEditorAfterClose` and the order a
	 * reader came through.
	 */
	close(id: number): void {
		this.closeMany([id]);
	}

	closeOthers(id: number): void {
		this.closeMany(this.list.filter(tab => tab.id !== id).map(tab => tab.id));
	}

	closeToTheRight(id: number): void {
		const index = this.indexOf(id);
		if (index !== -1) {
			this.closeMany(this.list.slice(index + 1).map(tab => tab.id));
		}
	}

	closeAll(): void {
		this.closeMany(this.list.map(tab => tab.id));
	}

	/**
	 * Ctrl+Shift+T. Brings back the most recently closed tab where it was, with its view state,
	 * skipping any whose file has been opened again since.
	 */
	reopenClosed(): Tab | undefined {
		for (let entry = this.closed.pop(); entry; entry = this.closed.pop()) {
			if (this.find(entry.path)) {
				continue;
			}
			const previousActive = this.activeId;
			const tab: Tab = {
				id: this.nextId++,
				path: entry.path,
				viewerId: entry.viewerId,
				preview: false,
				viewState: entry.viewState,
			};
			this.list.splice(Math.min(entry.index, this.list.length), 0, tab);
			this.setActive(tab.id);
			this.emit(previousActive);
			return tab;
		}
		return undefined;
	}

	get canReopenClosed(): boolean {
		return this.closed.some(entry => !this.find(entry.path));
	}

	private closeMany(ids: readonly number[]): void {
		const closing = new Set(ids.filter(id => this.get(id)));
		if (!closing.size) {
			return;
		}
		const previousActive = this.activeId;

		// Recorded left to right, so reopening brings them back right to left and each lands at
		// the index it had.
		for (const [index, tab] of this.list.entries()) {
			if (closing.has(tab.id)) {
				this.closed.push({ path: tab.path, viewerId: tab.viewerId, viewState: tab.viewState, index });
			}
		}
		this.closed.splice(0, Math.max(0, this.closed.length - CLOSED_HISTORY));

		this.list = this.list.filter(tab => !closing.has(tab.id));
		this.mru = this.mru.filter(id => !closing.has(id));
		if (this.activeId !== undefined && closing.has(this.activeId)) {
			this.activeId = this.mru[0];
		}

		this.emit(previousActive);
	}

	// --------------------------------------------------------------------- view state

	/** Stores what the viewer handed back as a tab was left. Not a change anyone redraws for. */
	setViewState(id: number, viewState: unknown): void {
		const tab = this.get(id);
		if (tab) {
			this.replace(tab, { ...tab, viewState });
		}
	}

	// ------------------------------------------------------------------------ ordering

	/** Drag and drop in the strip. `index` is the tab's position after the move. */
	move(id: number, index: number): void {
		const from = this.indexOf(id);
		if (from === -1) {
			return;
		}
		const to = Math.max(0, Math.min(index, this.list.length - 1));
		if (from === to) {
			return;
		}
		const [tab] = this.list.splice(from, 1);
		this.list.splice(to, 0, tab);
		this.emit(this.activeId);
	}

	// --------------------------------------------------------------------- persistence

	serialize(): SerializedTabs {
		return {
			version: 1,
			tabs: this.list.map(tab => ({
				path: tab.path,
				viewerId: tab.viewerId,
				preview: tab.preview,
				...(tab.viewState === undefined ? {} : { viewState: tab.viewState }),
			})),
			active: this.activeId === undefined ? -1 : this.indexOf(this.activeId),
		};
	}

	/**
	 * Rebuilds a model from what `serialize()` wrote on a previous run. The input comes off
	 * disk and may be stale, hand-edited or from another version, so it is validated the way
	 * `parseConfig()` validates settings: anything unusable is dropped, never thrown on.
	 *
	 * Whether each file still exists is the host's question, not this one; the shell answers
	 * it through `keep`.
	 */
	static restore(data: unknown, keep: (path: string) => boolean = () => true): TabsModel {
		const model = new TabsModel();
		if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.tabs)) {
			return model;
		}

		const activeIndex = typeof data.active === 'number' ? data.active : -1;
		let activeTab: Tab | undefined;
		let previewSeen = false;

		for (const [index, entry] of data.tabs.entries()) {
			if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path || !keep(entry.path)) {
				continue;
			}
			if (model.find(entry.path)) {
				continue;
			}
			// At most one preview tab, whatever the file says.
			const preview: boolean = entry.preview === true && !previewSeen;
			previewSeen ||= preview;
			const tab: Tab = {
				id: model.nextId++,
				path: entry.path,
				viewerId: typeof entry.viewerId === 'string' && entry.viewerId ? entry.viewerId : DEFAULT_VIEWER,
				preview,
				viewState: entry.viewState,
			};
			model.list.push(tab);
			if (index === activeIndex) {
				activeTab = tab;
			}
		}

		// Restored tabs have no history between them; left to right is as good an order as any,
		// with the active one first.
		model.mru = model.list.map(tab => tab.id);
		const active = activeTab ?? model.list[0];
		if (active) {
			model.setActive(active.id);
		}
		return model;
	}

	// ------------------------------------------------------------------------ helpers

	private indexOf(id: number): number {
		return this.list.findIndex(tab => tab.id === id);
	}

	private setActive(id: number): void {
		this.activeId = id;
		this.mru = [id, ...this.mru.filter(other => other !== id)];
	}

	/** Tabs are handed out as immutable values, so a change swaps the object in place. */
	private replace(tab: Tab, next: Tab): void {
		const index = this.list.indexOf(tab);
		if (index !== -1) {
			this.list[index] = next;
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
