/*---------------------------------------------------------------------------------------------
 *  SPDX-License-Identifier: GPL-3.0-only
 *  SPDX-FileCopyrightText: 2026 DigiGate
 *  SPDX-FileCopyrightText: Microsoft Corporation — MIT, see licenses/vscode.txt
 *
 *  Contains code derived from Visual Studio Code. See licenses/NOTICE.md for what this file
 *  derives from and how much it changed.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  MarkReader renderer.
 *
 *  This is the standalone counterpart to vscode's preview-src/index.ts. That file was built
 *  around bidirectional scroll sync with a text editor over postMessage; a read-only app
 *  needs none of it, so what survives here is the useful part: link handling, image and
 *  diagram hydration, and the outline.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownItEngine, type HeadingInfo } from './engine';
import { getPlugins } from './plugins';
import {
	getConfig,
	onConfigChanged,
	parseConfig,
	serializeConfig,
	setConfig,
	type FrontMatterRenderStyle,
	type ThemeMode,
} from './config';
import { basename, dirname, isMarkdownPath } from './paths';
import { escapeHtml } from './util';

interface MarkDocument {
	readonly path: string;
	readonly text: string;
}

interface TreeEntry {
	readonly path: string;
	readonly relativePath: string;
	readonly name: string;
}

interface FolderPayload {
	readonly root: string;
	readonly entries: readonly TreeEntry[];
}

interface MarkReaderApi {
	openFileDialog(): Promise<void>;
	openFolderDialog(): Promise<void>;
	openPath(filePath: string): Promise<void>;
	readFile(filePath: string): Promise<MarkDocument | undefined>;
	openExternal(url: string): Promise<void>;
	showInFolder(filePath: string): Promise<void>;
	setWindowBackground(color: string): Promise<void>;
	/** Settings from the previous run, already available when this module first runs. */
	readonly settings: Record<string, unknown> | undefined;
	saveSettings(settings: Record<string, unknown>): Promise<void>;
	pathForFile(file: File): string | undefined;
	onDocumentOpened(h: (doc: MarkDocument) => void): () => void;
	onDocumentChanged(h: (doc: MarkDocument) => void): () => void;
	onFolderOpened(h: (payload: FolderPayload) => void): () => void;
	onCommand(channel: string, h: (payload: unknown) => void): () => void;
}

declare global {
	interface Window {
		readonly markreader: MarkReaderApi;
	}
}

const api = window.markreader;

// ---------------------------------------------------------------------------- state

let engine = new MarkdownItEngine(getPlugins());

let currentDoc: MarkDocument | undefined;
let rootPath: string | undefined;
let treeEntries: readonly TreeEntry[] = [];
let headings: readonly HeadingInfo[] = [];
/** Scroll offsets are restored per document, so revisiting a file lands where you left. */
const scrollMemory = new Map<string, number>();

const el = {
	body: document.body,
	markdown: document.getElementById('markdown-body')!,
	docTitle: document.getElementById('doc-title')!,
	fileList: document.getElementById('file-list')!,
	fileFilter: document.getElementById('file-filter') as HTMLInputElement,
	tocList: document.getElementById('toc-list')!,
	findInput: document.getElementById('find-input') as HTMLInputElement,
	findCount: document.getElementById('find-count')!,
	btnSidebar: document.getElementById('btn-toggle-sidebar')!,
	btnOutline: document.getElementById('btn-toggle-outline')!,
};

// ----------------------------------------------------------------------- rendering

function render(): void {
	if (!currentDoc) {
		el.body.classList.add('no-document');
		el.markdown.innerHTML = '';
		headings = [];
		renderToc();
		return;
	}

	el.body.classList.remove('no-document');

	const output = engine.render(currentDoc.text, {
		documentPath: currentDoc.path,
		rootPath,
	});

	el.markdown.innerHTML = output.html;
	headings = output.headings;

	addHeadingAnchors();
	addCodeBlockCopyButtons();
	wrapWideTables();
	void renderMermaidBlocks();
	renderToc();
	refreshFind();
}

/**
 * Ported in spirit from preview-src/index.ts, which added the same affordance for
 * copying fenced code. The button markup relies on `.code-block-copy-button` from
 * the copied markdown.css.
 */
function addCodeBlockCopyButtons(): void {
	for (const pre of el.markdown.querySelectorAll('pre')) {
		if (pre.classList.contains('mermaid-fallback') || pre.querySelector('.code-block-copy-button')) {
			continue;
		}
		const button = document.createElement('button');
		button.className = 'code-block-copy-button';
		button.title = 'Copy';
		button.setAttribute('aria-label', 'Copy code block');
		button.innerHTML = `<svg class="mr-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 3.5H3.5a1 1 0 0 0-1 1v7"/></svg>`;
		button.addEventListener('click', async () => {
			const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
			try {
				await navigator.clipboard.writeText(code);
				button.classList.add('copied');
				button.title = 'Copied';
				setTimeout(() => {
					button.classList.remove('copied');
					button.title = 'Copy';
				}, 1400);
			} catch {
				// Clipboard can reject if the window isn't focused; nothing useful to do.
			}
		});
		pre.appendChild(button);
	}
}

function addHeadingAnchors(): void {
	for (const heading of el.markdown.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
		if (heading.querySelector('.heading-anchor')) {
			continue;
		}
		const anchor = document.createElement('a');
		anchor.className = 'heading-anchor';
		anchor.href = `#${heading.id}`;
		anchor.textContent = '#';
		anchor.title = 'Link to this section';
		anchor.setAttribute('aria-hidden', 'true');
		heading.insertBefore(anchor, heading.firstChild);
	}
}

/** Wrap tables so an over-wide table scrolls itself instead of the page. */
function wrapWideTables(): void {
	for (const table of el.markdown.querySelectorAll('table')) {
		if (table.parentElement?.classList.contains('table-wrapper') || table.classList.contains('frontmatter')) {
			continue;
		}
		const wrapper = document.createElement('div');
		wrapper.className = 'table-wrapper';
		table.parentNode?.insertBefore(wrapper, table);
		wrapper.appendChild(table);
	}
}

// ------------------------------------------------------------------------- mermaid

type MermaidApi = {
	initialize(config: Record<string, unknown>): void;
	render(id: string, text: string): Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | undefined;
let mermaidRenderSeq = 0;

/** Mermaid is ~2.5MB, so it's only pulled in once a document actually contains a diagram. */
async function loadMermaid(): Promise<MermaidApi> {
	if (!mermaidPromise) {
		mermaidPromise = import('mermaid').then(mod => mod.default as unknown as MermaidApi);
	}
	return mermaidPromise;
}

function mermaidTheme(): string {
	return el.body.classList.contains('vscode-dark') ? 'dark' : 'default';
}

async function renderMermaidBlocks(): Promise<void> {
	const blocks = Array.from(el.markdown.querySelectorAll<HTMLElement>('.mermaid-block'));
	if (!blocks.length || !getConfig().mermaid) {
		return;
	}

	let mermaid: MermaidApi;
	try {
		mermaid = await loadMermaid();
	} catch (e) {
		console.error('Failed to load mermaid', e);
		return;
	}

	mermaid.initialize({
		startOnLoad: false,
		theme: mermaidTheme(),
		securityLevel: 'strict',
		fontFamily: getComputedStyle(el.body).fontFamily,
	});

	// Guards against a second render (theme switch, live reload) interleaving with this one.
	const seq = ++mermaidRenderSeq;

	for (const [index, block] of blocks.entries()) {
		const source = block.dataset.mermaidSrc;
		if (!source) {
			continue;
		}
		try {
			const { svg } = await mermaid.render(`mr-mermaid-${seq}-${index}`, source);
			if (seq !== mermaidRenderSeq || !block.isConnected) {
				return;
			}
			const fallback = block.querySelector('.mermaid-fallback');
			block.innerHTML = svg;
			if (fallback) {
				block.appendChild(fallback);
			}
			block.classList.add('rendered');
			block.classList.remove('failed');
		} catch (e) {
			if (seq !== mermaidRenderSeq) {
				return;
			}
			// Leave the source visible and say why it didn't draw.
			block.classList.add('failed');
			block.classList.remove('rendered');
			if (!block.querySelector('.mermaid-error')) {
				const message = document.createElement('div');
				message.className = 'mermaid-error';
				message.textContent = `Mermaid diagram failed to render: ${(e as Error).message ?? e}`;
				block.insertBefore(message, block.firstChild);
			}
			// Mermaid appends its own error graphic to the body on failure.
			document.querySelectorAll('body > svg[id^="mr-mermaid-"]').forEach(n => n.remove());
		}
	}
}

// -------------------------------------------------------------------------- outline

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
		button.addEventListener('click', () => revealSlug(heading.slug));
		el.tocList.appendChild(button);
	}
	updateActiveTocEntry();
}

function updateActiveTocEntry(): void {
	if (!headings.length) {
		return;
	}

	// The active heading is the last one whose top edge is above the reading line.
	const readingLine = 90;
	let activeSlug: string | undefined;
	for (const heading of headings) {
		const node = document.getElementById(heading.slug);
		if (!node) {
			continue;
		}
		if (node.getBoundingClientRect().top <= readingLine) {
			activeSlug = heading.slug;
		} else {
			break;
		}
	}
	activeSlug ??= headings[0]?.slug;

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

function revealSlug(slug: string): void {
	const target = document.getElementById(slug)
		// Fall back to a fragment-style match, as VS Code's link handling does.
		?? document.getElementById(decodeURIComponent(slug));
	if (!target) {
		return;
	}
	const top = target.getBoundingClientRect().top + window.scrollY - 56;
	window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

	target.classList.remove('mr-target-flash');
	// Force a reflow so the animation replays when the same target is picked twice.
	void target.offsetWidth;
	target.classList.add('mr-target-flash');
}

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

	el.fileList.innerHTML = '';
	for (const entry of matches) {
		const button = document.createElement('button');
		button.className = 'file-entry';
		button.title = entry.relativePath;
		button.dataset.path = entry.path;
		if (currentDoc && samePath(currentDoc.path, entry.path)) {
			button.classList.add('active');
		}

		const dir = entry.relativePath.slice(0, entry.relativePath.length - entry.name.length);
		button.innerHTML = `<span>${dir ? `<span class="file-dir">${escapeHtml(dir)}</span>` : ''}${escapeHtml(entry.name)}</span>`;
		button.addEventListener('click', () => void api.openPath(entry.path));
		el.fileList.appendChild(button);
	}
}

function samePath(a: string, b: string): boolean {
	const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
	return normalize(a) === normalize(b);
}

// ------------------------------------------------------------------------ theming

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(): void {
	const mode = getConfig().theme;
	const dark = mode === 'dark' || (mode === 'system' && systemDark.matches);

	el.body.classList.toggle('vscode-dark', dark);
	el.body.classList.toggle('vscode-light', !dark);

	// Keep the native window background in step, so resizing doesn't flash white.
	const background = getComputedStyle(el.body).backgroundColor;
	const hex = rgbToHex(background);
	if (hex) {
		void api.setWindowBackground(hex);
	}

	// Mermaid bakes theme colors into the SVG, so diagrams must be redrawn.
	if (el.markdown.querySelector('.mermaid-block')) {
		void renderMermaidBlocks();
	}
}

function rgbToHex(color: string): string | undefined {
	const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	if (!match) {
		return undefined;
	}
	const [, r, g, b] = match;
	return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
}

systemDark.addEventListener('change', () => {
	if (getConfig().theme === 'system') {
		applyTheme();
	}
});

// --------------------------------------------------------------------------- find

let findMatches: Range[] = [];
let findIndex = 0;

function refreshFind(): void {
	if (!el.body.classList.contains('finding')) {
		return;
	}
	runFind(el.findInput.value);
}

/**
 * Uses the CSS Custom Highlight API, so matches are painted without mutating the DOM —
 * the same approach VS Code's preview uses for inner diff ranges.
 */
function runFind(query: string): void {
	clearFindHighlights();
	findMatches = [];
	findIndex = 0;

	if (query.length < 1) {
		updateFindCount();
		return;
	}

	const needle = query.toLowerCase();
	const walker = document.createTreeWalker(el.markdown, NodeFilter.SHOW_TEXT, {
		acceptNode: node => {
			const parent = node.parentElement;
			if (!parent || parent.closest('.heading-anchor, .code-block-copy-button, script, style')) {
				return NodeFilter.FILTER_REJECT;
			}
			return node.nodeValue && node.nodeValue.trim().length > 0
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_REJECT;
		},
	});

	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = (node.nodeValue ?? '').toLowerCase();
		let from = text.indexOf(needle);
		while (from !== -1) {
			const range = document.createRange();
			range.setStart(node, from);
			range.setEnd(node, from + needle.length);
			findMatches.push(range);
			from = text.indexOf(needle, from + needle.length);
		}
	}

	paintFindHighlights();
	updateFindCount();
	if (findMatches.length) {
		scrollToFindMatch(0);
	}
}

function paintFindHighlights(): void {
	if (!('highlights' in CSS)) {
		return;
	}
	const all = findMatches.filter((_, i) => i !== findIndex);
	const current = findMatches[findIndex];
	CSS.highlights.set('mr-find-match', new Highlight(...all));
	CSS.highlights.set('mr-find-current', new Highlight(...(current ? [current] : [])));
}

function clearFindHighlights(): void {
	if ('highlights' in CSS) {
		CSS.highlights.delete('mr-find-match');
		CSS.highlights.delete('mr-find-current');
	}
}

function updateFindCount(): void {
	el.findCount.textContent = findMatches.length
		? `${findIndex + 1} / ${findMatches.length}`
		: (el.findInput.value ? 'No results' : '0 / 0');
}

function scrollToFindMatch(index: number): void {
	const range = findMatches[index];
	if (!range) {
		return;
	}
	const rect = range.getBoundingClientRect();
	const top = rect.top + window.scrollY - window.innerHeight / 2;
	window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function stepFind(delta: number): void {
	if (!findMatches.length) {
		return;
	}
	findIndex = (findIndex + delta + findMatches.length) % findMatches.length;
	paintFindHighlights();
	updateFindCount();
	scrollToFindMatch(findIndex);
}

function openFind(): void {
	el.body.classList.add('finding');
	el.findInput.focus();
	el.findInput.select();
	refreshFind();
}

function closeFind(): void {
	el.body.classList.remove('finding');
	clearFindHighlights();
	findMatches = [];
	updateFindCount();
}

// ------------------------------------------------------------------- link handling

el.markdown.addEventListener('click', event => {
	const anchor = (event.target as HTMLElement).closest('a');
	if (!anchor) {
		return;
	}

	event.preventDefault();

	const rawHref = anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
	if (!rawHref) {
		return;
	}

	// In-page anchor
	if (rawHref.startsWith('#')) {
		revealSlug(rawHref.slice(1));
		return;
	}

	// External
	if (/^(https?|mailto):/i.test(rawHref)) {
		void api.openExternal(rawHref);
		return;
	}

	// Local: the engine already resolved this to an absolute path at render time.
	const resolved = anchor.getAttribute('data-resolved-path');
	if (resolved) {
		const fragment = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#') + 1) : undefined;
		if (isMarkdownPath(resolved)) {
			void openLocalMarkdown(resolved, fragment);
		} else {
			void api.showInFolder(resolved);
		}
	}
});

async function openLocalMarkdown(filePath: string, fragment?: string): Promise<void> {
	pendingFragment = fragment;
	await api.openPath(filePath);
}

let pendingFragment: string | undefined;

// ------------------------------------------------------------------ document flow

function setDocument(doc: MarkDocument, options: { preserveScroll: boolean }): void {
	const previousScroll = window.scrollY;
	const isSameDoc = currentDoc && samePath(currentDoc.path, doc.path);

	if (currentDoc && !isSameDoc) {
		scrollMemory.set(currentDoc.path, previousScroll);
	}

	currentDoc = doc;
	updateTitle();
	render();
	renderFileList();

	if (pendingFragment) {
		const fragment = pendingFragment;
		pendingFragment = undefined;
		requestAnimationFrame(() => revealSlug(fragment));
		return;
	}

	if (options.preserveScroll && isSameDoc) {
		// Live reload: hold position so saving doesn't yank the reader to the top.
		requestAnimationFrame(() => window.scrollTo({ top: previousScroll }));
	} else {
		const remembered = scrollMemory.get(doc.path) ?? 0;
		requestAnimationFrame(() => window.scrollTo({ top: remembered }));
	}
}

function updateTitle(): void {
	if (!currentDoc) {
		el.docTitle.textContent = 'No document';
		document.title = 'MarkReader';
		return;
	}
	const name = basename(currentDoc.path);
	const dir = dirname(currentDoc.path);
	el.docTitle.innerHTML = `${escapeHtml(name)} <span class="dirname">— ${escapeHtml(dir)}</span>`;
	el.docTitle.title = currentDoc.path;
	document.title = `${name} — MarkReader`;
}

/** Rebuild the engine after a setting that affects the plugin set or parser options. */
function rebuildEngine(): void {
	engine = new MarkdownItEngine(getPlugins());
	render();
}

// ------------------------------------------------------------------------- wiring

api.onDocumentOpened(doc => setDocument(doc, { preserveScroll: false }));
api.onDocumentChanged(doc => setDocument(doc, { preserveScroll: true }));

api.onFolderOpened(payload => {
	rootPath = payload.root;
	treeEntries = payload.entries;
	el.fileFilter.value = '';
	el.body.classList.add('has-sidebar');
	el.btnSidebar.setAttribute('aria-pressed', 'true');
	el.btnSidebar.classList.add('checked');
	renderFileList();
	// Opening a folder with no document showing? Show its README or first file.
	if (!currentDoc && treeEntries.length) {
		const readme = treeEntries.find(e => /^readme\./i.test(e.name)) ?? treeEntries[0];
		void api.openPath(readme.path);
	}
});

document.getElementById('btn-open-file')!.addEventListener('click', () => void api.openFileDialog());
document.getElementById('btn-open-folder')!.addEventListener('click', () => void api.openFolderDialog());
document.getElementById('empty-open-file')!.addEventListener('click', () => void api.openFileDialog());
document.getElementById('empty-open-folder')!.addEventListener('click', () => void api.openFolderDialog());

function togglePane(pane: 'sidebar' | 'outline', force?: boolean): void {
	const cls = pane === 'sidebar' ? 'has-sidebar' : 'has-outline';
	const button = pane === 'sidebar' ? el.btnSidebar : el.btnOutline;
	const on = force ?? !el.body.classList.contains(cls);
	el.body.classList.toggle(cls, on);
	button.setAttribute('aria-pressed', String(on));
	button.classList.toggle('checked', on);
	if (pane === 'outline') {
		// The outline is the one pane whose visibility is a setting, so it is the one that has
		// to be written back — otherwise it would be restored from a value nothing updates.
		setConfig({ showToc: on });
		if (on) {
			updateActiveTocEntry();
		}
	}
}

el.btnSidebar.addEventListener('click', () => togglePane('sidebar'));
el.btnOutline.addEventListener('click', () => togglePane('outline'));

document.getElementById('btn-theme')!.addEventListener('click', () => cycleTheme());
document.getElementById('btn-find')!.addEventListener('click', () => openFind());

el.fileFilter.addEventListener('input', () => renderFileList());

el.findInput.addEventListener('input', () => runFind(el.findInput.value));
el.findInput.addEventListener('keydown', event => {
	if (event.key === 'Enter') {
		event.preventDefault();
		stepFind(event.shiftKey ? -1 : 1);
	} else if (event.key === 'Escape') {
		closeFind();
	}
});
document.getElementById('find-next')!.addEventListener('click', () => stepFind(1));
document.getElementById('find-prev')!.addEventListener('click', () => stepFind(-1));
document.getElementById('find-close')!.addEventListener('click', () => closeFind());

function cycleTheme(): void {
	const dark = el.body.classList.contains('vscode-dark');
	setConfig({ theme: dark ? 'light' : 'dark' });
	applyTheme();
}

// Menu commands
api.onCommand('command:toggleSidebar', () => togglePane('sidebar'));
api.onCommand('command:toggleToc', () => togglePane('outline'));
api.onCommand('command:cycleTheme', () => cycleTheme());
api.onCommand('command:setTheme', mode => {
	setConfig({ theme: mode as ThemeMode });
	applyTheme();
});
api.onCommand('command:setFrontMatter', style => {
	setConfig({ frontMatter: style as FrontMatterRenderStyle });
	render();
});
api.onCommand('command:toggleWordWrap', () => {
	const wrap = !getConfig().wordWrap;
	setConfig({ wordWrap: wrap });
	el.body.classList.toggle('wordWrap', wrap);
});
api.onCommand('command:toggleMath', () => {
	setConfig({ math: !getConfig().math });
	// Math is a markdown-it plugin, so the parser has to be rebuilt.
	rebuildEngine();
});
api.onCommand('command:toggleMermaid', () => {
	const on = !getConfig().mermaid;
	setConfig({ mermaid: on });
	// Mermaid hydrates after render, so a plain re-render is enough either way.
	render();
});
api.onCommand('command:find', () => openFind());
api.onCommand('command:reloadDocument', async () => {
	if (currentDoc) {
		const reloaded = await api.readFile(currentDoc.path);
		if (reloaded) {
			setDocument(reloaded, { preserveScroll: true });
		}
	}
});
api.onCommand('command:about', () => {
	setDocument({
		path: 'About MarkReader',
		text: ABOUT_DOCUMENT,
	}, { preserveScroll: false });
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

// Scroll spy for the outline
let scrollRaf = 0;
window.addEventListener('scroll', () => {
	if (scrollRaf) {
		return;
	}
	scrollRaf = requestAnimationFrame(() => {
		scrollRaf = 0;
		if (el.body.classList.contains('has-outline')) {
			updateActiveTocEntry();
		}
	});
}, { passive: true });

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

// ---------------------------------------------------------------------- start-up

// Settings from the previous run, before anything is painted: the host has already read them
// off disk, so `applyTheme()` below applies the stored theme rather than the default one.
setConfig(parseConfig(api.settings));

// Registered after the restore, so restoring is not itself a write. Toggling a setting to the
// value it already has is not one either — that keeps a no-op menu click off the disk.
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

applyTheme();
togglePane('outline', getConfig().showToc);
el.body.classList.toggle('wordWrap', getConfig().wordWrap);
renderFileList();
render();
