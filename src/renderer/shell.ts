// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The desktop shell — everything around the reading surface.
 *
 *  The file list, the outline pane, the find bar, the toolbar, the window title, the menu
 *  commands and the settings write-back all live here, and none of it ships to another host.
 *  It talks to the document only through `DocumentView`: it calls methods on it and subscribes
 *  to its events. It never reaches into `#markdown-body`, and the document never reaches out
 *  here — that separation is what lets an Android WebView load the document half alone.
 *--------------------------------------------------------------------------------------------*/

import {
	getConfig,
	onConfigChanged,
	parseConfig,
	serializeConfig,
	setConfig,
	type FrontMatterRenderStyle,
	type ThemeMode,
} from './config';
import type { DocumentView, DocumentViewState, HeadingInfo } from './document';
import {
	capabilitiesOf,
	type MarkDocument,
	type MarkReaderApi,
	type OpenPathOptions,
	type TreeEntry,
} from './host';
import { escapeHtml } from './markdown-language-features/util/dom';
import { basename, dirname, samePath } from './paths';
import { TabsModel, type OpenOptions } from './tabs/model';
import { createTabStrip } from './tabs/strip';

export interface ShellOptions {
	readonly view: DocumentView;
	readonly api: MarkReaderApi;
}

/** What the composition root hands the document view, so its links open as tabs. */
export interface DesktopShell {
	openPath(filePath: string, options?: OpenPathOptions): Promise<void>;
}

export function startDesktopShell({ view, api }: ShellOptions): DesktopShell {
	const el = {
		body: document.body,
		viewer: document.getElementById('viewer')!,
		tabStrip: document.getElementById('tab-strip')!,
		docTitle: document.getElementById('doc-title')!,
		fileList: document.getElementById('file-list')!,
		fileFilter: document.getElementById('file-filter') as HTMLInputElement,
		tocList: document.getElementById('toc-list')!,
		findBar: document.getElementById('find-bar')!,
		findInput: document.getElementById('find-input') as HTMLInputElement,
		findCount: document.getElementById('find-count')!,
		btnSidebar: document.getElementById('btn-toggle-sidebar')!,
		btnOutline: document.getElementById('btn-toggle-outline')!,
	};

	let rootPath: string | undefined;
	let treeEntries: readonly TreeEntry[] = [];
	let headings: readonly HeadingInfo[] = [];
	let activeSlug: string | undefined;

	// ---------------------------------------------------------------------- file list

	function renderFileList(): void {
		if (!treeEntries.length) {
			el.fileList.innerHTML = rootPath
				? '<div class="pane-empty">No Markdown files found in this folder.</div>'
				: '<div class="pane-empty">No folder open. Use <strong>Folder</strong> to pick one.</div>';
			return;
		}

		const filter = el.fileFilter.value.trim().toLowerCase();
		const matches = filter
			? treeEntries.filter(e => e.relativePath.toLowerCase().includes(filter))
			: treeEntries;

		if (!matches.length) {
			el.fileList.innerHTML = '<div class="pane-empty">No files match the filter.</div>';
			return;
		}

		const current = view.currentDocument;
		el.fileList.innerHTML = '';
		for (const entry of matches) {
			const button = document.createElement('button');
			button.className = 'file-entry';
			button.title = entry.relativePath;
			button.dataset.path = entry.path;
			if (current && samePath(current.path, entry.path)) {
				button.classList.add('active');
			}

			const dir = entry.relativePath.slice(0, entry.relativePath.length - entry.name.length);
			button.innerHTML = `<span>${dir ? `<span class="file-dir">${escapeHtml(dir)}</span>` : ''}${escapeHtml(entry.name)}</span>`;
			// Browsing the list previews; a double-click keeps the tab, as in VS Code's explorer.
			button.addEventListener('click', () => void openInTab(entry.path, { mode: 'preview' }));
			button.addEventListener('dblclick', () => void openInTab(entry.path, { mode: 'pinned' }));
			el.fileList.appendChild(button);
		}
	}

	// ------------------------------------------------------------------------ outline

	function renderToc(): void {
		if (!headings.length) {
			el.tocList.innerHTML = '<div class="pane-empty">No headings.</div>';
			return;
		}

		el.tocList.innerHTML = '';
		for (const heading of headings) {
			const button = document.createElement('button');
			button.className = 'toc-entry';
			button.dataset.level = String(heading.level);
			button.dataset.slug = heading.slug;
			button.textContent = heading.text || '(untitled)';
			button.title = heading.text;
			button.addEventListener('click', () => view.revealSlug(heading.slug));
			el.tocList.appendChild(button);
		}
		markActiveTocEntry();
	}

	function markActiveTocEntry(): void {
		for (const entry of el.tocList.querySelectorAll<HTMLElement>('.toc-entry')) {
			const isActive = entry.dataset.slug === activeSlug;
			entry.classList.toggle('active', isActive);
			if (isActive) {
				scrollIntoViewIfNeeded(entry, el.tocList);
			}
		}
	}

	function scrollIntoViewIfNeeded(node: HTMLElement, container: HTMLElement): void {
		const nodeRect = node.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		if (nodeRect.top < containerRect.top || nodeRect.bottom > containerRect.bottom) {
			node.scrollIntoView({ block: 'nearest' });
		}
	}

	// -------------------------------------------------------------------------- title

	function updateTitle(): void {
		const current = view.currentDocument;
		if (!current) {
			el.docTitle.textContent = 'No document';
			document.title = 'MarkReader';
			return;
		}
		const name = basename(current.path);
		const dir = dirname(current.path);
		el.docTitle.innerHTML = `${escapeHtml(name)} <span class="dirname">— ${escapeHtml(dir)}</span>`;
		el.docTitle.title = current.path;
		document.title = `${name} — MarkReader`;
	}

	// --------------------------------------------------------------------- find bar

	function openFind(): void {
		el.body.classList.add('finding');
		el.findInput.focus();
		el.findInput.select();
		view.runFind(el.findInput.value);
	}

	function closeFind(): void {
		// Hiding the bar would drop focus on the body, from where keys scroll nothing.
		if (el.findBar.contains(document.activeElement)) {
			focusViewer();
		}
		el.body.classList.remove('finding');
		view.closeFind();
	}

	// ------------------------------------------------------------------------- focus

	/**
	 * The window does not scroll, so PageDown, Space and the arrows only move the document
	 * when focus is inside `#viewer`. Focus is put there when a document shows up with nothing
	 * else focused, and the chrome's buttons do not take it on a mouse press (they still do
	 * from Tab), so clicking the outline or a toolbar button leaves it where it was.
	 */
	function focusViewer(): void {
		el.viewer.focus({ preventScroll: true });
	}

	function focusViewerIfUnclaimed(): void {
		const active = document.activeElement;
		if (!active || active === el.body) {
			focusViewer();
		}
	}

	for (const chrome of [document.getElementById('toolbar')!, el.tabStrip, el.fileList, el.tocList, el.findBar]) {
		chrome.addEventListener('mousedown', event => {
			if ((event.target as HTMLElement).closest('button, .tab')) {
				event.preventDefault();
			}
		});
	}

	// -------------------------------------------------------------------------- tabs

	/*
	 * One `DocumentView` serves every tab, as one `EditorPane` serves every input of its type in
	 * VS Code: activating a tab hands the view that tab's document and the view state it was
	 * left with. The model holds neither text nor DOM, so the text lives here, by path.
	 */
	const tabs = new TabsModel();
	const strip = createTabStrip(el.tabStrip, tabs);
	const texts = new Map<string, MarkDocument>();
	/** Same equivalence as `samePath`, as a map key. */
	const keyOf = (path: string) => path.replace(/\\/g, '/').toLowerCase();

	/** The tab whose document the view was last handed. */
	let shownTabId: number | undefined;
	/** Guards `showActiveTab` against a later activation overtaking an earlier one. */
	let showSeq = 0;

	/**
	 * Open a document from inside the page — the file list, a link, a folder's README. It is
	 * read first, so a file that cannot be read never gets a tab; the host has already said why.
	 */
	async function openInTab(path: string, options: OpenOptions): Promise<void> {
		const existing = tabs.find(path);
		if (existing) {
			openTab(existing.path, options);
			return;
		}
		const doc = await api.readFile(path);
		if (doc) {
			texts.set(keyOf(doc.path), doc);
			openTab(doc.path, options);
			// As opening it through the host would have.
			void api.noteRecentDocument(doc.path);
		}
	}

	/**
	 * `tabs.open`, plus the one case its change event does not cover: opening the tab that is
	 * already showing. A link to `this.md#section`, say, still has a fragment to reveal.
	 */
	function openTab(path: string, options: OpenOptions): void {
		const before = tabs.active?.id;
		const tab = tabs.open(path, options);
		if (tab.id === before && tab.id === shownTabId) {
			refreshShownTab();
		}
	}

	function refreshShownTab(): void {
		const tab = shownTabId === undefined ? undefined : tabs.get(shownTabId);
		const doc = tab && texts.get(keyOf(tab.path));
		if (doc) {
			view.setDocument(doc, { preserveScroll: true });
		}
	}

	/**
	 * Hand the view the active tab. The host is told first and awaited: it serves `mdr://` only
	 * from beside the active document, so rendering before it has switched would leave the new
	 * document's images unreachable for their first paint.
	 */
	async function showActiveTab(): Promise<void> {
		const seq = ++showSeq;
		const tab = tabs.active;
		if (!tab) {
			shownTabId = undefined;
			await syncHost();
			if (seq === showSeq) {
				view.clearDocument();
			}
			return;
		}

		const key = keyOf(tab.path);
		if (tab.path === ABOUT_PATH) {
			// The shell's own text, not a file: a reopened About tab has nothing to read.
			texts.set(key, ABOUT);
		}
		if (!texts.has(key)) {
			const read = await api.readFile(tab.path);
			if (seq !== showSeq) {
				return;
			}
			if (!read) {
				// Gone since it was opened, and the host has said so. Discarded rather than closed,
				// so that reopening closed tabs does not keep landing on it.
				tabs.discard(tab.id);
				return;
			}
			// A save that arrived while this read was in flight is newer than what it returned.
			if (!texts.has(key)) {
				texts.set(key, read);
			}
		}

		await syncHost();
		if (seq !== showSeq) {
			return;
		}
		// Read after the awaits, not before: a save or reload during them updated the text but
		// could not render it, since this tab was not the one showing yet.
		const doc = texts.get(key);
		if (!doc) {
			return;
		}
		shownTabId = tab.id;
		view.setDocument(doc, { preserveScroll: false, viewState: tab.viewState as DocumentViewState | undefined });
	}

	/** The last state the host was told, and the call telling it — so a repeat can await it. */
	let synced: { key: string; done: Promise<void> } | undefined;

	/**
	 * Tell the host which documents are open and which is showing, so it watches exactly those
	 * and serves from beside the active one. The About tab is the shell's own text, not a file;
	 * the host ignores paths like it.
	 */
	function syncHost(): Promise<void> {
		const open = tabs.tabs.map(tab => tab.path);
		const active = tabs.active?.path;
		const key = JSON.stringify([open, active]);
		if (synced?.key !== key) {
			const call: { key: string; done: Promise<void> } = {
				key,
				// A failed call is forgotten, so the next one retries rather than re-throwing it.
				done: api.syncDocuments(open, active).catch(error => {
					if (synced === call) {
						synced = undefined;
					}
					console.error('syncDocuments failed', error);
				}),
			};
			synced = call;
		}
		return synced.done;
	}

	/**
	 * Keeps the showing tab's view state current as the reader scrolls, so whatever happens to
	 * it next — another tab activated, it closed and reopened — it has where it was left. The
	 * path check skips the gap while the view is still showing the previous document.
	 */
	function recordShownViewState(): void {
		const tab = shownTabId === undefined ? undefined : tabs.get(shownTabId);
		const current = view.currentDocument;
		if (tab && current && samePath(tab.path, current.path)) {
			tabs.setViewState(tab.id, view.getViewState());
		}
	}

	// Synchronously, not on the next animation frame: storing it is cheap, and a frame is not
	// guaranteed to come in time — WebKitGTK throttles them in a window it thinks is hidden,
	// so a deferred record could miss the switch it was needed for.
	el.viewer.addEventListener('scroll', () => recordShownViewState(), { passive: true });

	tabs.onChange(change => {
		// The tab being left, before anything changes what the view shows.
		if (change.activeChanged) {
			recordShownViewState();
		}
		el.body.classList.toggle('has-tabs', tabs.tabs.length > 0);
		strip.render();
		// The model keeps no text, so text for a tab that has gone is dropped here.
		const open = new Set(tabs.tabs.map(tab => keyOf(tab.path)));
		for (const key of texts.keys()) {
			if (!open.has(key)) {
				texts.delete(key);
			}
		}
		if (change.activeChanged) {
			void showActiveTab();
		} else {
			void syncHost();
		}
	});

	/**
	 * Ctrl+Tab walks the tabs by recent use while Ctrl is held, as VS Code's quick switch does,
	 * over the order as it was when the walk began — activating each tab on the way would
	 * otherwise reorder it underneath. Letting go of Ctrl ends the walk.
	 */
	let recentWalk: { readonly order: readonly number[]; index: number } | undefined;

	function walkRecent(delta: number): void {
		recentWalk ??= { order: tabs.recent.map(tab => tab.id), index: 0 };
		// A tab closed mid-walk (Ctrl+W with Ctrl still held) is stepped over, not landed on.
		const order = recentWalk.order;
		const count = order.length;
		for (let step = 0; step < count; step++) {
			recentWalk.index = (((recentWalk.index + delta) % count) + count) % count;
			if (tabs.get(order[recentWalk.index])) {
				tabs.activate(order[recentWalk.index]);
				return;
			}
		}
	}

	window.addEventListener('keyup', event => {
		if (event.key === 'Control' || event.key === 'Meta') {
			recentWalk = undefined;
		}
	});
	window.addEventListener('blur', () => {
		recentWalk = undefined;
	});

	function closeActiveTab(): void {
		if (tabs.active) {
			tabs.close(tabs.active.id);
		}
	}

	// ---------------------------------------------------------------- document events

	view.on('document', doc => {
		el.body.classList.toggle('no-document', !doc);
		updateTitle();
		renderFileList();
		if (doc) {
			focusViewerIfUnclaimed();
		}
	});

	view.on('headings', next => {
		headings = next;
		renderToc();
	});

	view.on('activeHeading', slug => {
		activeSlug = slug;
		if (el.body.classList.contains('has-outline')) {
			markActiveTocEntry();
		}
	});

	view.on('find', state => {
		el.findCount.textContent = state.total
			? `${state.index + 1} / ${state.total}`
			: (state.query ? 'No results' : '0 / 0');
	});

	view.on('theme', state => {
		// Keep the native window background in step, so resizing doesn't flash white. There is
		// no native window behind a WebView host, which is why this is a declared capability.
		if (state.background && capabilitiesOf(api).windowBackground) {
			void api.setWindowBackground?.(state.background);
		}
	});

	// ------------------------------------------------------------------------- panes

	function togglePane(pane: 'sidebar' | 'outline', force?: boolean): void {
		const cls = pane === 'sidebar' ? 'has-sidebar' : 'has-outline';
		const button = pane === 'sidebar' ? el.btnSidebar : el.btnOutline;
		const on = force ?? !el.body.classList.contains(cls);
		el.body.classList.toggle(cls, on);
		button.setAttribute('aria-pressed', String(on));
		button.classList.toggle('checked', on);
		if (pane === 'outline') {
			// The outline is the one pane whose visibility is a setting, so it is the one that
			// has to be written back — otherwise it would be restored from a value nothing
			// updates.
			setConfig({ showToc: on });
			if (on) {
				markActiveTocEntry();
			}
		}
	}

	function cycleTheme(): void {
		setConfig({ theme: el.body.classList.contains('vscode-dark') ? 'light' : 'dark' });
		view.applyTheme();
	}

	// ------------------------------------------------------------------------- wiring

	// Opened from outside the page — the dialog, the command line, a second launch, a drop. The
	// host has read it fresh, so an already open tab takes the new text.
	api.onDocumentOpened(doc => {
		texts.set(keyOf(doc.path), doc);
		openTab(doc.path, { mode: 'pinned' });
	});

	// Saved on disk. A background tab only stores the text, and shows it once activated.
	api.onDocumentChanged(doc => {
		const tab = tabs.find(doc.path);
		if (!tab) {
			return;
		}
		texts.set(keyOf(tab.path), doc);
		if (tab.id === shownTabId) {
			view.setDocument(doc, { preserveScroll: true });
		}
	});

	api.onFolderOpened(payload => {
		rootPath = payload.root;
		treeEntries = payload.entries;
		view.setRootPath(payload.root);
		el.fileFilter.value = '';
		togglePane('sidebar', true);
		renderFileList();
		// Opening a folder with no document showing? Show its README or first file.
		if (!tabs.active && treeEntries.length) {
			const readme = treeEntries.find(e => /^readme\./i.test(e.name)) ?? treeEntries[0];
			void openInTab(readme.path, { mode: 'preview' });
		}
	});

	document.getElementById('btn-open-file')!.addEventListener('click', () => void api.openFileDialog());
	document.getElementById('btn-open-folder')!.addEventListener('click', () => void api.openFolderDialog());
	document.getElementById('empty-open-file')!.addEventListener('click', () => void api.openFileDialog());
	document.getElementById('empty-open-folder')!.addEventListener('click', () => void api.openFolderDialog());

	el.btnSidebar.addEventListener('click', () => togglePane('sidebar'));
	el.btnOutline.addEventListener('click', () => togglePane('outline'));

	document.getElementById('btn-theme')!.addEventListener('click', () => cycleTheme());
	document.getElementById('btn-find')!.addEventListener('click', () => openFind());

	el.fileFilter.addEventListener('input', () => renderFileList());

	el.findInput.addEventListener('input', () => view.runFind(el.findInput.value));
	el.findInput.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			event.preventDefault();
			view.stepFind(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			closeFind();
		}
	});
	document.getElementById('find-next')!.addEventListener('click', () => view.stepFind(1));
	document.getElementById('find-prev')!.addEventListener('click', () => view.stepFind(-1));
	document.getElementById('find-close')!.addEventListener('click', () => closeFind());

	// Menu commands
	api.onCommand('command:toggleSidebar', () => togglePane('sidebar'));
	api.onCommand('command:toggleToc', () => togglePane('outline'));
	api.onCommand('command:cycleTheme', () => cycleTheme());
	api.onCommand('command:setTheme', mode => {
		setConfig({ theme: mode as ThemeMode });
		view.applyTheme();
	});
	api.onCommand('command:setFrontMatter', style => {
		setConfig({ frontMatter: style as FrontMatterRenderStyle });
		view.render();
	});
	api.onCommand('command:toggleWordWrap', () => {
		const wrap = !getConfig().wordWrap;
		setConfig({ wordWrap: wrap });
		view.setWordWrap(wrap);
	});
	api.onCommand('command:toggleMath', () => {
		setConfig({ math: !getConfig().math });
		// Math is a markdown-it plugin, so the parser has to be rebuilt.
		view.rebuildEngine();
	});
	api.onCommand('command:toggleMermaid', () => {
		setConfig({ mermaid: !getConfig().mermaid });
		// Mermaid hydrates after render, so a plain re-render is enough either way.
		view.render();
	});
	api.onCommand('command:find', () => openFind());
	api.onCommand('command:reloadDocument', () => {
		const tab = tabs.active;
		if (!tab || tab.path === ABOUT_PATH) {
			return;
		}
		void api.readFile(tab.path).then(doc => {
			if (doc && tabs.get(tab.id)) {
				texts.set(keyOf(tab.path), doc);
				if (tab.id === shownTabId) {
					view.setDocument(doc, { preserveScroll: true });
				}
			}
		});
	});
	api.onCommand('command:about', () => {
		texts.set(keyOf(ABOUT_PATH), ABOUT);
		openTab(ABOUT_PATH, { mode: 'pinned' });
	});
	api.onCommand('command:closeTab', () => closeActiveTab());
	api.onCommand('command:reopenClosedTab', () => void tabs.reopenClosed());

	// Keyboard shortcuts that aren't menu accelerators
	window.addEventListener('keydown', event => {
		if (event.key === 'Escape' && el.body.classList.contains('finding')) {
			closeFind();
			return;
		}

		// Tab switching. Not menu accelerators: Ctrl+Tab is not reliably one on every platform,
		// and the walk needs to see Ctrl being let go.
		if (event.ctrlKey && !event.altKey && !event.metaKey) {
			if (event.key === 'Tab') {
				event.preventDefault();
				walkRecent(event.shiftKey ? -1 : 1);
				return;
			}
			if (event.key === 'PageDown' || event.key === 'PageUp') {
				event.preventDefault();
				tabs.activateRelative(event.key === 'PageDown' ? 1 : -1);
				return;
			}
			// By key position, not character: AZERTY types `&` on the key that is `1` elsewhere.
			const digit = /^Digit([1-9])$/.exec(event.code);
			if (!event.shiftKey && digit) {
				event.preventDefault();
				tabs.activateIndex(Number(digit[1]) - 1);
				return;
			}
		}

		// Ctrl+F is also a menu accelerator, but catching it here keeps focus behaviour
		// consistent when the find bar is already open.
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			openFind();
		}
	});

	// Drag & drop
	window.addEventListener('dragover', event => {
		event.preventDefault();
		el.body.classList.add('drag-over');
	});
	window.addEventListener('dragleave', event => {
		if (event.relatedTarget === null) {
			el.body.classList.remove('drag-over');
		}
	});
	window.addEventListener('drop', event => {
		event.preventDefault();
		el.body.classList.remove('drag-over');
		const file = event.dataTransfer?.files?.[0];
		if (!file) {
			return;
		}
		const droppedPath = api.pathForFile(file);
		if (droppedPath) {
			void openInTab(droppedPath, { mode: 'pinned' });
		}
	});

	// ------------------------------------------------------------------------ start-up

	// Settings from the previous run, before anything is painted: the host has already read
	// them off disk, so `applyTheme()` below applies the stored theme rather than the default.
	setConfig(parseConfig(api.settings));

	// Registered after the restore, so restoring is not itself a write. Toggling a setting to
	// the value it already has is not one either — that keeps a no-op menu click off the disk.
	let savedSettings = JSON.stringify(serializeConfig());
	onConfigChanged(() => {
		const settings = serializeConfig();
		const serialized = JSON.stringify(settings);
		if (serialized === savedSettings) {
			return;
		}
		savedSettings = serialized;
		void api.saveSettings(settings);
	});

	view.applyTheme();
	togglePane('outline', getConfig().showToc);
	view.setWordWrap(getConfig().wordWrap);
	el.body.classList.toggle('no-document', !view.currentDocument);
	updateTitle();
	renderFileList();
	view.render();

	return {
		// A link Ctrl-clicked into the background is kept: previews replace each other, and a
		// reader collecting links to come back to wants all of them.
		openPath: (filePath, options) =>
			openInTab(filePath, options?.background ? { mode: 'pinned', background: true } : { mode: 'preview' }),
	};
}

const ABOUT_PATH = 'About MarkReader';

const ABOUT_DOCUMENT = `# MarkReader

A standalone Markdown reader built from VS Code's Markdown preview.

## What was reused

| Piece | Origin |
| --- | --- |
| Markdown engine | \`markdown-language-features/src/markdownEngine.ts\` |
| Heading slugs | \`markdown-language-features/src/slugify.ts\` |
| Front matter | \`markdown-language-features/src/extensions/yamlPreamble/\` |
| Document styles | \`markdown-language-features/media/markdown.css\` |
| Code highlighting | \`markdown-language-features/media/highlight.css\` |
| Math | \`markdown-math\` |
| Diagrams | \`mermaid-markdown-features\` |

Those files are MIT licensed, © Microsoft Corporation.

## Shortcuts

| Action | Key |
| --- | --- |
| Open file | \`Ctrl+O\` |
| Open folder | \`Ctrl+Shift+O\` |
| Close tab | \`Ctrl+W\` |
| Reopen closed tab | \`Ctrl+Shift+T\` |
| Next / previous tab, by recent use | \`Ctrl+Tab\` / \`Ctrl+Shift+Tab\` |
| Next / previous tab, by position | \`Ctrl+PgDn\` / \`Ctrl+PgUp\` |
| Go to tab 1–8, or the last | \`Ctrl+1\` … \`Ctrl+8\`, \`Ctrl+9\` |
| Toggle sidebar | \`Ctrl+B\` |
| Toggle outline | \`Ctrl+Shift+B\` |
| Find in document | \`Ctrl+F\` |
| Toggle light/dark | \`Ctrl+K\` |
| Reload document | \`Ctrl+R\` |
| Zoom | \`Ctrl+\` / \`Ctrl-\` |
`;

/** The About tab's document. Not a file: the host is never asked to read it. */
const ABOUT: MarkDocument = { path: ABOUT_PATH, text: ABOUT_DOCUMENT };
