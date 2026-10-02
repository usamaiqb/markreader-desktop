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
import type { DocumentView, HeadingInfo } from './document';
import { capabilitiesOf, type MarkReaderApi, type TreeEntry } from './host';
import { escapeHtml } from './markdown-language-features/util/dom';
import { basename, dirname, samePath } from './paths';

export interface ShellOptions {
	readonly view: DocumentView;
	readonly api: MarkReaderApi;
}

export function startDesktopShell({ view, api }: ShellOptions): void {
	const el = {
		body: document.body,
		docTitle: document.getElementById('doc-title')!,
		fileList: document.getElementById('file-list')!,
		fileFilter: document.getElementById('file-filter') as HTMLInputElement,
		tocList: document.getElementById('toc-list')!,
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
			button.addEventListener('click', () => void api.openPath(entry.path));
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
		el.body.classList.remove('finding');
		view.closeFind();
	}

	// ---------------------------------------------------------------- document events

	view.on('document', doc => {
		el.body.classList.toggle('no-document', !doc);
		updateTitle();
		renderFileList();
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

	api.onDocumentOpened(doc => view.setDocument(doc, { preserveScroll: false }));
	api.onDocumentChanged(doc => view.setDocument(doc, { preserveScroll: true }));

	api.onFolderOpened(payload => {
		rootPath = payload.root;
		treeEntries = payload.entries;
		view.setRootPath(payload.root);
		el.fileFilter.value = '';
		togglePane('sidebar', true);
		renderFileList();
		// Opening a folder with no document showing? Show its README or first file.
		if (!view.currentDocument && treeEntries.length) {
			const readme = treeEntries.find(e => /^readme\./i.test(e.name)) ?? treeEntries[0];
			void api.openPath(readme.path);
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
	api.onCommand('command:reloadDocument', () => void view.reload());
	api.onCommand('command:about', () => {
		view.setDocument({ path: 'About MarkReader', text: ABOUT_DOCUMENT }, { preserveScroll: false });
	});

	// Keyboard shortcuts that aren't menu accelerators
	window.addEventListener('keydown', event => {
		if (event.key === 'Escape' && el.body.classList.contains('finding')) {
			closeFind();
			return;
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
			void api.openPath(droppedPath);
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
}

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
| Toggle sidebar | \`Ctrl+B\` |
| Toggle outline | \`Ctrl+Shift+B\` |
| Find in document | \`Ctrl+F\` |
| Toggle light/dark | \`Ctrl+K\` |
| Reload document | \`Ctrl+R\` |
| Zoom | \`Ctrl+\` / \`Ctrl-\` |
`;
