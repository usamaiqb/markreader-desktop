/*---------------------------------------------------------------------------------------------
 *  SPDX-License-Identifier: GPL-3.0-only
 *  SPDX-FileCopyrightText: 2026 DigiGate
 *  SPDX-FileCopyrightText: Microsoft Corporation — MIT, see licenses/vscode.txt
 *
 *  Contains code derived from Visual Studio Code. See licenses/NOTICE.md for what this file
 *  derives from and how much it changed.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  The document half of the renderer — the part both hosts share.
 *
 *  It owns everything inside the reading surface: rendering markdown into it, hydrating code
 *  blocks and diagrams, resolving link clicks, finding text, tracking which heading is in
 *  view, and applying the theme the stylesheets key off. It draws no chrome. Anything a host
 *  needs to draw its own — the outline, a title, a match counter — leaves through `on()`.
 *
 *  The rule that keeps this shareable: **it touches no DOM outside its root**, apart from the
 *  theme classes below, and it reaches the app only through `DocumentHost`. A `document.
 *  getElementById('some-pane')` in here is a bug, not a shortcut.
 *--------------------------------------------------------------------------------------------*/

import { getConfig } from './config';
import { MarkdownItEngine, type HeadingInfo } from './engine';
import { capabilitiesOf, type DocumentHost, type MarkDocument } from './host';
import { ensureMath, prepareForDocument } from './lazy';
import { isMarkdownPath, samePath } from './paths';
import { getPlugins } from './plugins';
import { setDocumentHtml } from './sanitizer';

export type { HeadingInfo, MarkDocument };

export interface FindState {
	readonly query: string;
	/** 0-based index of the current match, or -1 when there are none. */
	readonly index: number;
	readonly total: number;
}

export interface ThemeState {
	readonly dark: boolean;
	/** The resolved background as `#rrggbb`, or undefined if it didn't parse. */
	readonly background: string | undefined;
}

/**
 * What the document tells whoever is drawing around it. This is the whole outward surface —
 * if the shell needs something that isn't here, it belongs here rather than in a reach into
 * the document's DOM.
 */
export interface DocumentViewEventMap {
	/** A different document is showing, or none. */
	readonly document: MarkDocument | undefined;
	/** The outline changed. Emitted on every render, before `activeHeading`. */
	readonly headings: readonly HeadingInfo[];
	/** The heading under the reading line, as scrolling moves it. */
	readonly activeHeading: string | undefined;
	readonly find: FindState;
	readonly theme: ThemeState;
}

export type DocumentViewListener<K extends keyof DocumentViewEventMap> =
	(payload: DocumentViewEventMap[K]) => void;

export interface DocumentViewOptions {
	/** The element rendered markdown goes into — the one `markdown.css` styles. */
	readonly root: HTMLElement;
	readonly host: DocumentHost;
}

/** Distance from the top of the viewport at which a heading counts as "current". */
const READING_LINE = 90;

/** Headroom left above a revealed target, so it isn't flush against the top edge. */
const REVEAL_OFFSET = 56;

const NO_MATCHES: FindState = { query: '', index: -1, total: 0 };

export class DocumentView {
	private readonly root: HTMLElement;
	private readonly host: DocumentHost;

	/**
	 * The element carrying `vscode-dark` / `vscode-light` and `wordWrap`. This is the one
	 * piece of DOM outside the root that the document owns, and it is not a choice:
	 * `markdown.css` selects `body.wordWrap pre`, and `highlight.css` selects
	 * `.vscode-light .hljs-*`. The stylesheets are copied verbatim from VS Code, so the
	 * classes go where they expect them.
	 */
	private readonly themeRoot: HTMLElement;

	private engine = new MarkdownItEngine(getPlugins());

	private doc: MarkDocument | undefined;
	private root_: string | undefined;
	private headings: readonly HeadingInfo[] = [];
	private activeSlug: string | undefined;

	/** Scroll offsets are restored per document, so revisiting a file lands where you left. */
	private readonly scrollMemory = new Map<string, number>();

	/** Set when a link carried a fragment, consumed once that document has rendered. */
	private pendingFragment: string | undefined;

	private findMatches: Range[] = [];
	private findIndex = 0;
	private findQuery = '';
	private findActive = false;

	private mermaidPromise: Promise<MermaidApi> | undefined;
	private mermaidRenderSeq = 0;

	/** Guards the await in `setDocumentAsync` against a second document overtaking the first. */
	private documentSeq = 0;

	private scrollRaf = 0;

	private readonly listeners = new Map<string, Set<(payload: never) => void>>();

	private readonly systemDark = window.matchMedia('(prefers-color-scheme: dark)');

	constructor(options: DocumentViewOptions) {
		this.root = options.root;
		this.host = options.host;
		this.themeRoot = options.root.ownerDocument.body;

		this.root.addEventListener('click', event => this.onLinkClick(event));

		window.addEventListener('scroll', () => this.onScroll(), { passive: true });

		this.systemDark.addEventListener('change', () => {
			if (getConfig().theme === 'system') {
				this.applyTheme();
			}
		});
	}

	// ------------------------------------------------------------------------- events

	on<K extends keyof DocumentViewEventMap>(event: K, listener: DocumentViewListener<K>): () => void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener as (payload: never) => void);
		return () => set.delete(listener as (payload: never) => void);
	}

	private emit<K extends keyof DocumentViewEventMap>(event: K, payload: DocumentViewEventMap[K]): void {
		for (const listener of this.listeners.get(event) ?? []) {
			(listener as DocumentViewListener<K>)(payload);
		}
	}

	// -------------------------------------------------------------------------- state

	get currentDocument(): MarkDocument | undefined {
		return this.doc;
	}

	get currentHeadings(): readonly HeadingInfo[] {
		return this.headings;
	}

	/** The folder a document was opened from, used to resolve root-relative links. */
	setRootPath(rootPath: string | undefined): void {
		this.root_ = rootPath;
	}

	// ---------------------------------------------------------------- document flow

	setDocument(doc: MarkDocument, options: { preserveScroll: boolean }): void {
		void this.setDocumentAsync(doc, options);
	}

	/**
	 * The document's modules are loaded before it is painted, so it appears once and complete
	 * rather than reflowing as KaTeX or highlight.js arrive. See `lazy.ts`.
	 *
	 * `setDocument` is kept synchronous for callers, which only ever fire and forget. The
	 * sequence guard is what makes that safe: two documents opened in quick succession would
	 * otherwise race through the await below and paint in whichever order their modules
	 * happened to resolve.
	 */
	private async setDocumentAsync(doc: MarkDocument, options: { preserveScroll: boolean }): Promise<void> {
		const seq = ++this.documentSeq;
		const prepared = await prepareForDocument(doc.text);
		if (seq !== this.documentSeq) {
			return;
		}
		if (prepared.pluginsChanged) {
			this.engine = new MarkdownItEngine(getPlugins());
		}

		const previousScroll = window.scrollY;
		const isSameDoc = this.doc !== undefined && samePath(this.doc.path, doc.path);

		if (this.doc && !isSameDoc) {
			this.scrollMemory.set(this.doc.path, previousScroll);
		}

		this.doc = doc;
		this.emit('document', doc);
		this.render();

		if (this.pendingFragment) {
			const fragment = this.pendingFragment;
			this.pendingFragment = undefined;
			requestAnimationFrame(() => this.revealSlug(fragment));
			return;
		}

		if (options.preserveScroll && isSameDoc) {
			// Live reload: hold position so saving doesn't yank the reader to the top.
			requestAnimationFrame(() => window.scrollTo({ top: previousScroll }));
		} else {
			const remembered = this.scrollMemory.get(doc.path) ?? 0;
			requestAnimationFrame(() => window.scrollTo({ top: remembered }));
		}
	}

	/** Re-read the showing document from the host and re-render it in place. */
	async reload(): Promise<void> {
		if (!this.doc) {
			return;
		}
		const reloaded = await this.host.readFile(this.doc.path);
		if (reloaded) {
			this.setDocument(reloaded, { preserveScroll: true });
		}
	}

	/**
	 * Rebuild the engine after a setting that changes the plugin set or parser options.
	 *
	 * Turning math on by hand has to load KaTeX whether or not the open document looked like
	 * it needed it — the setting is not about this document.
	 */
	rebuildEngine(): void {
		void (async () => {
			if (getConfig().math) {
				await ensureMath();
			}
			this.engine = new MarkdownItEngine(getPlugins());
			this.render();
		})();
	}

	// ---------------------------------------------------------------------- rendering

	render(): void {
		if (!this.doc) {
			this.root.innerHTML = '';
			this.setHeadings([]);
			return;
		}

		const output = this.engine.render(this.doc.text, {
			documentPath: this.doc.path,
			rootPath: this.root_,
		});

		setDocumentHtml(this.root, output.html);

		this.addHeadingAnchors();
		this.addCodeBlockCopyButtons();
		this.wrapWideTables();
		void this.renderMermaidBlocks();
		this.setHeadings(output.headings);
		this.refreshFind();
	}

	private setHeadings(headings: readonly HeadingInfo[]): void {
		this.headings = headings;
		this.emit('headings', headings);
		this.updateActiveHeading();
	}

	/**
	 * Ported in spirit from preview-src/index.ts, which added the same affordance for
	 * copying fenced code. The button markup relies on `.code-block-copy-button` from
	 * the copied markdown.css.
	 */
	private addCodeBlockCopyButtons(): void {
		for (const pre of this.root.querySelectorAll('pre')) {
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

	private addHeadingAnchors(): void {
		const selector = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]';
		for (const heading of this.root.querySelectorAll<HTMLElement>(selector)) {
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
	private wrapWideTables(): void {
		for (const table of this.root.querySelectorAll('table')) {
			if (table.parentElement?.classList.contains('table-wrapper') || table.classList.contains('frontmatter')) {
				continue;
			}
			const wrapper = document.createElement('div');
			wrapper.className = 'table-wrapper';
			table.parentNode?.insertBefore(wrapper, table);
			wrapper.appendChild(table);
		}
	}

	// ------------------------------------------------------------------------ mermaid

	/** Mermaid is ~2.5MB, so it's only pulled in once a document actually contains a diagram. */
	private async loadMermaid(): Promise<MermaidApi> {
		this.mermaidPromise ??= import('mermaid').then(mod => mod.default as unknown as MermaidApi);
		return this.mermaidPromise;
	}

	private async renderMermaidBlocks(): Promise<void> {
		const blocks = Array.from(this.root.querySelectorAll<HTMLElement>('.mermaid-block'));
		if (!blocks.length || !getConfig().mermaid) {
			return;
		}

		let mermaid: MermaidApi;
		try {
			mermaid = await this.loadMermaid();
		} catch (e) {
			console.error('Failed to load mermaid', e);
			return;
		}

		mermaid.initialize({
			startOnLoad: false,
			theme: this.themeRoot.classList.contains('vscode-dark') ? 'dark' : 'default',
			securityLevel: 'strict',
			fontFamily: getComputedStyle(this.themeRoot).fontFamily,
		});

		// Guards against a second render (theme switch, live reload) interleaving with this one.
		const seq = ++this.mermaidRenderSeq;

		for (const [index, block] of blocks.entries()) {
			// The fallback `<pre>` is the diagram's source of truth; see `#addMermaidRenderer`.
			// It survives hydration below, so a re-render (theme switch) still finds it.
			const source = block.querySelector('.mermaid-fallback')?.textContent;
			if (!source) {
				continue;
			}
			try {
				const { svg } = await mermaid.render(`mr-mermaid-${seq}-${index}`, source);
				if (seq !== this.mermaidRenderSeq || !block.isConnected) {
					return;
				}
				const fallback = block.querySelector('.mermaid-fallback');
				// Not routed through `setDocumentHtml`: mermaid's `securityLevel: 'strict'`
				// above already runs its own DOMPurify pass over this SVG, and our document
				// profile drops `foreignObject` — which is how mermaid draws HTML labels.
				block.innerHTML = svg;
				if (fallback) {
					block.appendChild(fallback);
				}
				block.classList.add('rendered');
				block.classList.remove('failed');
			} catch (e) {
				if (seq !== this.mermaidRenderSeq) {
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

	// ------------------------------------------------------------------------ outline

	private onScroll(): void {
		if (this.scrollRaf) {
			return;
		}
		this.scrollRaf = requestAnimationFrame(() => {
			this.scrollRaf = 0;
			this.updateActiveHeading();
		});
	}

	private updateActiveHeading(): void {
		// The active heading is the last one whose top edge is above the reading line.
		let active: string | undefined;
		for (const heading of this.headings) {
			const node = document.getElementById(heading.slug);
			if (!node) {
				continue;
			}
			if (node.getBoundingClientRect().top <= READING_LINE) {
				active = heading.slug;
			} else {
				break;
			}
		}
		active ??= this.headings[0]?.slug;

		if (active !== this.activeSlug) {
			this.activeSlug = active;
			this.emit('activeHeading', active);
		}
	}

	revealSlug(slug: string): void {
		const target = document.getElementById(slug)
			// Fall back to a fragment-style match, as VS Code's link handling does.
			?? document.getElementById(decodeURIComponent(slug));
		if (!target) {
			return;
		}
		const top = target.getBoundingClientRect().top + window.scrollY - REVEAL_OFFSET;
		window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

		target.classList.remove('mr-target-flash');
		// Force a reflow so the animation replays when the same target is picked twice.
		void target.offsetWidth;
		target.classList.add('mr-target-flash');
	}

	// ------------------------------------------------------------------------ theming

	applyTheme(): void {
		const mode = getConfig().theme;
		const dark = mode === 'dark' || (mode === 'system' && this.systemDark.matches);

		this.themeRoot.classList.toggle('vscode-dark', dark);
		this.themeRoot.classList.toggle('vscode-light', !dark);

		const background = rgbToHex(getComputedStyle(this.themeRoot).backgroundColor);
		this.emit('theme', { dark, background });

		// Mermaid bakes theme colors into the SVG, so diagrams must be redrawn.
		if (this.root.querySelector('.mermaid-block')) {
			void this.renderMermaidBlocks();
		}
	}

	setWordWrap(wrap: boolean): void {
		this.themeRoot.classList.toggle('wordWrap', wrap);
	}

	// --------------------------------------------------------------------------- find

	/** Called when the host's find affordance opens, so a stale query repaints. */
	openFind(): void {
		this.findActive = true;
		this.runFind(this.findQuery);
	}

	closeFind(): void {
		this.findActive = false;
		this.clearFindHighlights();
		this.findMatches = [];
		this.findQuery = '';
		this.emit('find', NO_MATCHES);
	}

	private refreshFind(): void {
		if (this.findActive) {
			this.runFind(this.findQuery);
		}
	}

	/**
	 * Uses the CSS Custom Highlight API, so matches are painted without mutating the DOM —
	 * the same approach VS Code's preview uses for inner diff ranges.
	 */
	runFind(query: string): void {
		this.findActive = true;
		this.findQuery = query;
		this.clearFindHighlights();
		this.findMatches = [];
		this.findIndex = 0;

		if (query.length < 1) {
			this.emitFindState();
			return;
		}

		const needle = query.toLowerCase();
		const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
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
				this.findMatches.push(range);
				from = text.indexOf(needle, from + needle.length);
			}
		}

		this.paintFindHighlights();
		this.emitFindState();
		if (this.findMatches.length) {
			this.scrollToFindMatch(0);
		}
	}

	stepFind(delta: number): void {
		if (!this.findMatches.length) {
			return;
		}
		this.findIndex = (this.findIndex + delta + this.findMatches.length) % this.findMatches.length;
		this.paintFindHighlights();
		this.emitFindState();
		this.scrollToFindMatch(this.findIndex);
	}

	private emitFindState(): void {
		this.emit('find', {
			query: this.findQuery,
			index: this.findMatches.length ? this.findIndex : -1,
			total: this.findMatches.length,
		});
	}

	private paintFindHighlights(): void {
		if (!('highlights' in CSS)) {
			return;
		}
		const all = this.findMatches.filter((_, i) => i !== this.findIndex);
		const current = this.findMatches[this.findIndex];
		CSS.highlights.set('mr-find-match', new Highlight(...all));
		CSS.highlights.set('mr-find-current', new Highlight(...(current ? [current] : [])));
	}

	private clearFindHighlights(): void {
		if ('highlights' in CSS) {
			CSS.highlights.delete('mr-find-match');
			CSS.highlights.delete('mr-find-current');
		}
	}

	private scrollToFindMatch(index: number): void {
		const range = this.findMatches[index];
		if (!range) {
			return;
		}
		const rect = range.getBoundingClientRect();
		const top = rect.top + window.scrollY - window.innerHeight / 2;
		window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
	}

	// ------------------------------------------------------------------- link handling

	private onLinkClick(event: MouseEvent): void {
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
			this.revealSlug(rawHref.slice(1));
			return;
		}

		// External
		if (/^(https?|mailto):/i.test(rawHref)) {
			void this.host.openExternal(rawHref);
			return;
		}

		// Local: the engine already resolved this to an absolute path at render time.
		const resolved = anchor.getAttribute('data-resolved-path');
		if (!resolved) {
			return;
		}
		if (isMarkdownPath(resolved)) {
			this.pendingFragment = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#') + 1) : undefined;
			void this.host.openPath(resolved);
		} else if (capabilitiesOf(this.host).revealInFolder) {
			// A link to a non-markdown file goes to the file manager, where there is one.
			// Android has none, and the click is simply inert there.
			void this.host.showInFolder?.(resolved);
		}
	}
}

type MermaidApi = {
	initialize(config: Record<string, unknown>): void;
	render(id: string, text: string): Promise<{ svg: string }>;
};

function rgbToHex(color: string): string | undefined {
	const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	if (!match) {
		return undefined;
	}
	const [, r, g, b] = match;
	return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
}
