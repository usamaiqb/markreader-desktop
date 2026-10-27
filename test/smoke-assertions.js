// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Smoke test — the assertions.
 *
 *  This file is evaluated INSIDE the webview by the Rust side (`markreader --smoke <this file>
 *  <document>`), so it can inspect the live DOM directly. Results go back over IPC to
 *  `smoke_report`, which prints them and exits the process with the failure count.
 *
 *  Run with:  npm test
 *--------------------------------------------------------------------------------------------*/

(async () => {
	const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
	const smoke = window.__SMOKE__ ?? { file: null, root: null, consoleErrors: [] };

	const lines = [];
	const failures = [];

	const log = message => lines.push(message);

	function check(name, condition, detail = '') {
		if (condition) {
			log(`  PASS  ${name}`);
		} else {
			log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
			failures.push(name);
		}
	}

	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

	/** Waits until `fn` returns something truthy, or gives up. */
	async function waitFor(description, fn, timeoutMs = 15000) {
		const started = Date.now();
		for (;;) {
			let value;
			try {
				value = await fn();
			} catch {
				value = undefined;
			}
			if (value) {
				return value;
			}
			if (Date.now() - started > timeoutMs) {
				throw new Error(`Timed out waiting for: ${description}`);
			}
			await sleep(120);
		}
	}

	try {
		log('');
		log('--- document loading ---');
		await waitFor('document rendered', () =>
			document.querySelectorAll('#markdown-body h1').length > 0);
		check('document renders', true);

		log('');
		log('--- engine output ---');

		const counts = {
			headingsWithIds: document.querySelectorAll('#markdown-body h1[id],#markdown-body h2[id],#markdown-body h3[id],#markdown-body h4[id],#markdown-body h5[id],#markdown-body h6[id]').length,
			codeLines: document.querySelectorAll('#markdown-body .code-line[data-line]').length,
			hljsTokens: document.querySelectorAll('#markdown-body pre code .hljs-keyword, #markdown-body pre code .hljs-string, #markdown-body pre code .hljs-title').length,
			copyButtons: document.querySelectorAll('#markdown-body .code-block-copy-button').length,
			frontMatterRows: document.querySelectorAll('#markdown-body table.frontmatter tr').length,
			katexInline: document.querySelectorAll('#markdown-body .katex').length,
			katexDisplay: document.querySelectorAll('#markdown-body .katex-display').length,
			katexInlineOnly: Array.from(document.querySelectorAll('#markdown-body .katex'))
				.filter(n => !n.closest('.katex-display')).length,
			mermaidBlocks: document.querySelectorAll('#markdown-body .mermaid-block').length,
			tocEntries: document.querySelectorAll('#toc-list .toc-entry').length,
			anchors: document.querySelectorAll('#markdown-body .heading-anchor').length,
			taskCheckboxes: document.querySelectorAll('#markdown-body input[type=checkbox]').length,
			tables: document.querySelectorAll('#markdown-body .table-wrapper > table').length,
			mdrImages: Array.from(document.querySelectorAll('#markdown-body img')).map(i => i.getAttribute('src')),
			dupSlugs: Array.from(document.querySelectorAll('#markdown-body h2')).map(h => h.id).filter(id => id.startsWith('duplicate-heading')),
			rawHtmlPassthrough: !!document.querySelector('#markdown-body div[align=center] strong'),
		};

		check('source-map data-line attributes present', counts.codeLines > 20, `got ${counts.codeLines}`);
		check('heading ids generated', counts.headingsWithIds >= 15, `got ${counts.headingsWithIds}`);
		check('duplicate headings get unique slugs',
			counts.dupSlugs.length === 2 && counts.dupSlugs[0] !== counts.dupSlugs[1],
			JSON.stringify(counts.dupSlugs));
		check('syntax highlighting applied', counts.hljsTokens > 5, `${counts.hljsTokens} tokens`);
		check('copy buttons added to code blocks', counts.copyButtons >= 3, `got ${counts.copyButtons}`);
		check('front matter rendered as table', counts.frontMatterRows >= 5, `${counts.frontMatterRows} rows`);
		check('raw HTML passthrough works', counts.rawHtmlPassthrough);
		check('task list checkboxes rendered', counts.taskCheckboxes === 4, `got ${counts.taskCheckboxes}`);
		check('tables wrapped for overflow', counts.tables >= 1, `got ${counts.tables}`);
		check('heading anchors added', counts.anchors >= 15, `got ${counts.anchors}`);
		check('outline populated', counts.tocEntries >= 15, `got ${counts.tocEntries}`);

		log('');
		log('--- math (KaTeX) ---');
		// The sample has 1 inline expression and 2 display blocks. Each display block also
		// contains a .katex node, so 3 total is the expected count.
		check('inline + display math rendered', counts.katexInline >= 3, `${counts.katexInline} .katex nodes`);
		check('display math blocks rendered', counts.katexDisplay >= 2, `${counts.katexDisplay} .katex-display`);
		check('inline math is not inside a display block', counts.katexInlineOnly >= 1, `${counts.katexInlineOnly}`);

		log('');
		log('--- images (mdr:// protocol) ---');
		// WebView2 supports no custom schemes, so on Windows the runtime serves this protocol
		// from http://mdr.localhost. Both spellings reach the same Rust handler.
		const isMdr = src => !!src &&
			(src.startsWith('mdr://localhost/') || src.startsWith('http://mdr.localhost/'));
		check('relative image rewritten to mdr://',
			counts.mdrImages.some(isMdr),
			JSON.stringify(counts.mdrImages));

		// Images load asynchronously over mdr://, so wait rather than sampling immediately.
		const imageLoaded = await waitFor('badge.svg to load', () => {
			const img = Array.from(document.querySelectorAll('#markdown-body img'))
				.find(i => i.getAttribute('data-src')?.includes('badge.svg'));
			return img && img.complete && img.naturalWidth > 0
				? { complete: img.complete, w: img.naturalWidth, h: img.naturalHeight }
				: null;
		}).catch(() => null);
		check('local image actually loaded over mdr://',
			imageLoaded && imageLoaded.w > 0,
			JSON.stringify(imageLoaded));

		// The sample also points at a file that isn't there: that must 404, not hang.
		const missing = Array.from(document.querySelectorAll('#markdown-body img'))
			.find(i => i.getAttribute('data-src')?.includes('does-not-exist'));
		const missingSettled = await waitFor('missing image to settle',
			() => (missing && missing.complete ? { w: missing.naturalWidth } : null), 8000)
			.catch(() => null);
		check('missing local file 404s instead of hanging',
			!!missingSettled && missingSettled.w === 0, JSON.stringify(missingSettled));

		log('');
		log('--- mermaid ---');
		check('mermaid blocks emitted', counts.mermaidBlocks === 3, `got ${counts.mermaidBlocks}`);

		await waitFor('mermaid to finish', () =>
			document.querySelectorAll('.mermaid-block.rendered, .mermaid-block.failed').length >= 3, 45000);

		const mermaid = {
			rendered: document.querySelectorAll('.mermaid-block.rendered > svg').length,
			failed: document.querySelectorAll('.mermaid-block.failed').length,
			// Mermaid's scratch element is `div#d<id>` wrapping `svg#<id>`, so match either.
			strayErrorSvgs: document.querySelectorAll('body > [id*="mr-mermaid-"]').length,
		};
		check('two valid diagrams rendered to SVG', mermaid.rendered === 2, JSON.stringify(mermaid));
		check('broken diagram degrades to error state', mermaid.failed === 1, JSON.stringify(mermaid));
		check('no stray mermaid error graphics leaked into body', mermaid.strayErrorSvgs === 0);

		// mermaid/vsCodeTheme.ts fills nodes with `--vscode-editorWidget-background`, as VS Code does:
		// #202020 in Dark Modern, #f8f8f8 in Light Modern. mermaid's stock themes use neither.
		const nodeFill = () => {
			const rect = document.querySelector('.mermaid-block.rendered > svg .node rect');
			return rect ? getComputedStyle(rect).fill : 'no node rect';
		};
		const expectedFill = document.body.classList.contains('vscode-dark') ? 'rgb(32, 32, 32)' : 'rgb(248, 248, 248)';
		check('diagrams use the VS Code mermaid theme', nodeFill() === expectedFill, nodeFill());

		log('');
		log('--- scroll container ---');
		// The document scrolls inside #viewer, not the window. If the window could scroll, the
		// toolbar would no longer be what stays put, and every check below that drives #viewer
		// would be watching the wrong scroller.
		const viewer = document.getElementById('viewer');
		check('the document scrolls in its own container',
			viewer.scrollHeight > viewer.clientHeight
				&& document.documentElement.scrollHeight <= document.documentElement.clientHeight,
			JSON.stringify({
				viewer: [viewer.scrollHeight, viewer.clientHeight],
				page: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
			}));
		check('the scroll container has focus, so keys scroll the document',
			viewer.contains(document.activeElement),
			document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : 'none');

		log('');
		log('--- outline navigation ---');
		const scrollBeforeNav = viewer.scrollTop;
		// The reveal is a smooth scroll, and under xvfb WebKitGTK sometimes never ticks the
		// animation at all — scrollTop stays put however long we wait. So check what the app
		// controls: that the click asked to scroll down the document. Patched on the element,
		// shadowing Element.prototype.scrollTo, and removed again afterwards.
		let requestedTop = null;
		viewer.scrollTo = function (options) {
			requestedTop = typeof options === 'object' ? options.top : arguments[1];
			return Element.prototype.scrollTo.apply(this, arguments);
		};
		try {
			document.querySelectorAll('#toc-list .toc-entry')[8]?.click();
		} finally {
			delete viewer.scrollTo;
		}
		check('clicking an outline entry scrolls the document',
			requestedTop !== null && requestedTop > scrollBeforeNav,
			JSON.stringify({ before: scrollBeforeNav, requested: requestedTop }));

		// Give a working animation the chance to land; if the engine never ran it, jump there so
		// the later checks (scroll spy, scroll held across live reload) see a scrolled page
		// rather than passing trivially at the top.
		if (requestedTop !== null) {
			await waitFor('outline scroll to land', () => Math.abs(viewer.scrollTop - requestedTop) < 2, 3000)
				.catch(() => viewer.scrollTo({ top: requestedTop, behavior: 'instant' }));
		}

		const activeToc = document.querySelectorAll('#toc-list .toc-entry.active').length;
		check('scroll spy marks exactly one active outline entry', activeToc === 1, `got ${activeToc}`);

		log('');
		log('--- document overrides ---');
		// Proves the override layer is wired: linked by the page, copied by the build, and
		// winning over markdown.css. If document-overrides.css silently 404s the document still
		// renders, and only these fail.
		// Not the front matter table — that one is built by frontMatter.ts with its own rules,
		// and it is the first table in the document.
		const th = getComputedStyle(
			document.querySelector('#markdown-body table:not(.frontmatter) th'));
		const diagram = getComputedStyle(document.querySelector('#markdown-body .mermaid-block'));
		const taggedInternals =
			document.querySelectorAll('#markdown-body :is(thead,tbody,tr,th,td)[dir]').length;

		check('table headers align to the writing direction, not left',
			th.textAlign === 'start', th.textAlign);
		check('mermaid styling survived the move out of app.css',
			diagram.overflowX === 'auto', diagram.overflowX);
		check('front matter rules from markdown.css are in effect',
			getComputedStyle(document.querySelector('#markdown-body table.frontmatter'))
				.borderCollapse === 'collapse');
		check('no dir attribute on table internals', taggedInternals === 0, `${taggedInternals} tagged`);
		check('the table itself still carries dir="auto"',
			document.querySelector('#markdown-body table:not(.frontmatter)')
				?.getAttribute('dir') === 'auto');

		// The blockquote fix only shows up in an RTL context — in LTR the logical and physical
		// edges are the same one, so an LTR document cannot tell the two apart. Probe with a
		// throwaway element rather than asserting a width, which Chromium snaps to device
		// pixels (5px reads back as 4.667px at 1.5x).
		const probe = document.createElement('blockquote');
		probe.setAttribute('dir', 'rtl');
		document.getElementById('markdown-body').appendChild(probe);
		const rtl = getComputedStyle(probe);
		const rtlBar = {
			right: parseFloat(rtl.borderRightWidth),
			left: parseFloat(rtl.borderLeftWidth),
			padStart: parseFloat(rtl.paddingRight),
		};
		probe.remove();
		check('an RTL blockquote puts its bar on the right edge',
			rtlBar.right > 4 && rtlBar.left === 0, JSON.stringify(rtlBar));
		check('an RTL blockquote pads the side its bar is on',
			rtlBar.padStart === 10, JSON.stringify(rtlBar));

		log('');
		log('--- find bar ---');
		document.getElementById('btn-find').click();
		const findInput = document.getElementById('find-input');
		findInput.value = 'markdown';
		findInput.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep(400);
		const find = {
			visible: getComputedStyle(document.getElementById('find-bar')).display !== 'none',
			count: document.getElementById('find-count').textContent,
			highlightRanges: CSS.highlights.get('mr-find-match')?.size ?? 0,
			hasCurrent: (CSS.highlights.get('mr-find-current')?.size ?? 0) === 1,
		};
		check('find bar opens', find.visible);
		check('find locates matches',
			/^[0-9]+ \/ [0-9]+$/.test(find.count.trim()) && !find.count.trim().startsWith('0 /'),
			find.count);
		check('matches painted via CSS Custom Highlight API', find.highlightRanges > 0,
			`${find.highlightRanges} ranges`);
		check('current match highlighted separately', find.hasCurrent);

		document.getElementById('find-close').click();
		viewer.scrollTo({ top: 0 });

		log('');
		log('--- theme switch ---');
		// The theme button toggles against whatever is showing, and the default mode is
		// 'system' — so the starting theme is the host's colour scheme, not a constant. Settle
		// on dark first, or the single click below lands on dark wherever no dark preference
		// is set, which is every CI runner.
		if (!document.body.classList.contains('vscode-dark')) {
			document.getElementById('btn-theme').click();
			await waitFor('dark theme applied', () => document.body.classList.contains('vscode-dark'));
		}

		document.getElementById('btn-theme').click();
		await waitFor('light theme applied', () => document.body.classList.contains('vscode-light'));

		const light = {
			cls: document.body.className,
			bg: getComputedStyle(document.body).backgroundColor,
			codeBg: getComputedStyle(document.querySelector('#markdown-body pre')).backgroundColor,
			// Skip .heading-anchor, which is deliberately styled as muted chrome.
			linkColor: getComputedStyle(
				document.querySelector('#markdown-body p a:not(.heading-anchor)')).color,
		};
		check('light theme sets vscode-light', light.cls.includes('vscode-light'));
		check('light theme background is light', light.bg === 'rgb(255, 255, 255)', light.bg);
		check('theme variables reach the copied markdown.css', light.codeBg === 'rgb(243, 243, 243)', light.codeBg);
		check('links are themed', light.linkColor === 'rgb(0, 95, 184)', light.linkColor);

		// Mermaid re-renders on theme change; let it settle before moving on.
		await waitFor('mermaid redraw in light theme', () =>
			document.querySelectorAll('.mermaid-block.rendered > svg').length === 2, 45000);
		const lightFill = await waitFor('diagram colors to follow the theme', () => nodeFill() === 'rgb(248, 248, 248)')
			.then(() => nodeFill(), () => nodeFill());
		check('diagram colors follow a theme switch', lightFill === 'rgb(248, 248, 248)', lightFill);

		log('');
		log('--- panes ---');
		document.getElementById('btn-toggle-sidebar').click();
		check('sidebar toggles on', document.body.classList.contains('has-sidebar'));
		check('outline still on', document.body.classList.contains('has-outline'));

		log('');
		log('--- tabs ---');
		// Before the folder is opened on purpose: once it is, the whole repository is a resource
		// root, and an image beside another tab's document would load whether or not the roots
		// follow the active tab. The fixture documents live in test/tmp/fixtures, outside the sample's
		// folder rather than in it; smoke.mjs links the sample copy to them.
		const tabEls = () => Array.from(document.querySelectorAll('#tab-strip .tab'));
		const activeTab = () => document.querySelector('#tab-strip .tab.active');
		/** A tab's path is the first line of its tooltip; a preview tab adds a second. */
		const tabPath = tab => (tab?.title ?? '').split('\n')[0].replace(/\\/g, '/');
		const tabFor = suffix => tabEls().find(tab => tabPath(tab).endsWith('/' + suffix));
		const activeIs = suffix => tabPath(activeTab()).endsWith('/' + suffix);
		const tabState = () => JSON.stringify({
			tabs: tabEls().map(tab => tabPath(tab).split('/').pop() + (tab.classList.contains('preview') ? '*' : '')),
			active: tabPath(activeTab()).split('/').pop() ?? null,
			title: document.title,
		});
		const h1Text = () => document.querySelector('#markdown-body h1')?.textContent ?? '';
		/** The view has painted `suffix` — the shell's title and the document body both. */
		const showing = (suffix, heading) => activeIs(suffix)
			&& document.title.startsWith(suffix.split('/').pop() + ' ')
			&& (heading === undefined || h1Text().includes(heading));
		const kitchenShowing = () => showing('samples/kitchen-sink.md')
			&& !!document.querySelector('#markdown-body .mermaid-block');
		const docLink = suffix => Array.from(document.querySelectorAll('#markdown-body a'))
			.find(a => (a.getAttribute('data-href') ?? a.getAttribute('href') ?? '').endsWith(suffix));
		const mouse = (target, type, init = {}) => target.dispatchEvent(new MouseEvent(type, {
			bubbles: true, cancelable: true, view: window, ...init,
		}));
		const key = (keyName, init = {}) => (document.activeElement ?? document.body).dispatchEvent(
			new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ctrlKey: true, ...init }));
		/** What the menu does for an accelerator: the same event, from the page instead of Rust. */
		const emitCommand = channel => invoke('plugin:event|emit', { event: channel, payload: null });

		const strip = document.getElementById('tab-strip');
		// smoke.mjs launches with two files: the b.md fixture, then the sample.
		await waitFor('both start-up documents to have tabs', () => tabEls().length === 2 && kitchenShowing())
			.catch(() => null);
		const startTabs = tabEls();
		check('each file on the command line gets a tab, in order',
			startTabs.length === 2 && tabPath(startTabs[0]).endsWith('/tabs/b.md') && tabPath(startTabs[1]).endsWith('/samples/kitchen-sink.md'),
			tabState());
		check('the last file on the command line is the one showing', kitchenShowing(), tabState());
		check('the start-up tabs are pinned, not previews',
			startTabs.length === 2 && startTabs.every(tab => !tab.classList.contains('preview')), tabState());

		// The rest of this section counts tabs from the sample alone.
		mouse(tabFor('tabs/b.md')?.querySelector('.tab-close'), 'click');
		check('closing the extra start-up tab leaves the sample', tabEls().length === 1 && kitchenShowing(), tabState());
		check('the tab strip shows', getComputedStyle(strip).display !== 'none' && strip.offsetHeight > 0,
			`display ${getComputedStyle(strip).display}, height ${strip.offsetHeight}`);

		// Leave the sample somewhere other than the top, to see it come back there.
		viewer.scrollTo({ top: 1200, behavior: 'instant' });
		await sleep(300);
		const kitchenTop = viewer.scrollTop;

		const toA = docLink('tabs/a.md');
		toA?.click();
		await waitFor('a.md to show', () => showing('tabs/a.md', 'Tabs fixture A'))
			.catch(() => null);
		check('a plain click on a document link shows its target',
			!!toA && showing('tabs/a.md', 'Tabs fixture A'), tabState());
		check('... in a new preview tab beside the pinned one',
			tabEls().length === 2 && activeTab()?.classList.contains('preview') === true, tabState());

		// Roots follow the active tab: a.md is outside the sample's folder, and no folder is
		// open, so its image is reachable only if the host was switched to it before the paint.
		const pixel = await waitFor('pixel.svg to load', () => {
			const img = Array.from(document.querySelectorAll('#markdown-body img'))
				.find(i => i.getAttribute('data-src')?.includes('pixel.svg'));
			return img && img.complete && img.naturalWidth > 0 ? { w: img.naturalWidth, src: img.src } : null;
		}, 8000).catch(() => null);
		check('an image beside the active tab\'s document loads over mdr://', pixel && pixel.w > 0,
			JSON.stringify(pixel));
		// And the roots really are scoped, or the check above proves nothing: a file that exists,
		// one folder over from a.md and outside the sample's folder too, must not be served.
		const outside = await waitFor('outside.svg to settle', () => {
			const img = Array.from(document.querySelectorAll('#markdown-body img'))
				.find(i => i.getAttribute('data-src')?.includes('outside.svg'));
			return img && img.complete ? { w: img.naturalWidth } : null;
		}, 8000).catch(() => null);
		check('an image outside the active tab\'s roots is refused', !!outside && outside.w === 0,
			JSON.stringify(outside));

		const toB = docLink('b.md');
		if (toB) {
			mouse(toB, 'click', { ctrlKey: true });
		}
		await waitFor('b.md tab', () => tabFor('tabs/b.md')).catch(() => null);
		check('Ctrl+click on a document link opens a tab', tabEls().length === 3 && !!tabFor('tabs/b.md'), tabState());
		check('... in the background, leaving the active tab showing',
			showing('tabs/a.md', 'Tabs fixture A'), tabState());
		check('... pinned, so the next preview does not replace it',
			tabFor('tabs/b.md') && !tabFor('tabs/b.md').classList.contains('preview'), tabState());

		const toC = docLink('c.md');
		if (toC) {
			mouse(toC, 'auxclick', { button: 1 });
		}
		await waitFor('c.md tab', () => tabFor('tabs/c.md')).catch(() => null);
		check('middle-click on a document link opens a background tab too',
			tabEls().length === 4 && !!tabFor('tabs/c.md') && showing('tabs/a.md', 'Tabs fixture A'), tabState());

		// Each tab keeps its own scroll position.
		check('the fixture document is long enough to scroll', viewer.scrollHeight > viewer.clientHeight + 500,
			`${viewer.scrollHeight} / ${viewer.clientHeight}`);
		viewer.scrollTo({ top: 400, behavior: 'instant' });
		await sleep(300);
		const aTop = viewer.scrollTop;

		tabFor('samples/kitchen-sink.md')?.click();
		const kitchenBack = await waitFor('sample scroll to be restored',
			() => kitchenShowing() && Math.abs(viewer.scrollTop - kitchenTop) <= 2, 8000)
			.then(() => true, () => false);
		check('switching back to a tab restores its scroll position', kitchenBack,
			`left at ${kitchenTop}, back at ${viewer.scrollTop}; ${tabState()}`);

		tabFor('tabs/a.md')?.click();
		const aBack = await waitFor('a.md scroll to be restored',
			() => showing('tabs/a.md', 'Tabs fixture A') && Math.abs(viewer.scrollTop - aTop) <= 2, 8000)
			.then(() => true, () => false);
		check('... and every tab its own', aBack && aTop > 0,
			`left at ${aTop}, back at ${viewer.scrollTop}; ${tabState()}`);

		// Keyboard. The order is the sample, a, then each background tab opened right of a.
		const order = tabEls().map(tabPath);
		const indexOf = suffix => order.findIndex(p => p.endsWith('/' + suffix));
		key('PageDown');
		await waitFor('Ctrl+PgDn', () => activeTab() === tabEls()[indexOf('tabs/a.md') + 1], 3000).catch(() => null);
		check('Ctrl+PgDn activates the next tab', activeTab() === tabEls()[indexOf('tabs/a.md') + 1], tabState());
		const afterPgDn = tabPath(activeTab());

		key('Tab');
		(document.activeElement ?? document.body).dispatchEvent(
			new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
		await waitFor('Ctrl+Tab', () => activeIs('tabs/a.md'), 3000).catch(() => null);
		check('Ctrl+Tab goes back to the tab used before', activeIs('tabs/a.md'),
			`from ${afterPgDn}; ${tabState()}`);

		key('1', { code: 'Digit1' });
		await waitFor('Ctrl+1', () => kitchenShowing(), 8000).catch(() => null);
		check('Ctrl+1 activates the first tab', activeTab() === tabEls()[0] && kitchenShowing(), tabState());

		// Close falls back along recent use, not to a neighbour: activate c.md from the sample,
		// so closing it should land on the sample though a.md and b.md are beside it.
		key(String(indexOf('tabs/c.md') + 1));
		await waitFor('c.md to show', () => showing('tabs/c.md', 'Tabs fixture C'), 8000).catch(() => null);
		const closeC = tabFor('tabs/c.md')?.querySelector('.tab-close');
		closeC?.click();
		await waitFor('c.md to close', () => !tabFor('tabs/c.md') && kitchenShowing(), 8000).catch(() => null);
		check('the close button closes its tab', !!closeC && !tabFor('tabs/c.md') && tabEls().length === 3, tabState());
		check('... and the tab used before it shows, not its neighbour', kitchenShowing(), tabState());

		const bTab = tabFor('tabs/b.md');
		if (bTab) {
			mouse(bTab, 'auxclick', { button: 1 });
		}
		await waitFor('b.md to close', () => !tabFor('tabs/b.md'), 3000).catch(() => null);
		check('middle-click on a tab closes it', !!bTab && !tabFor('tabs/b.md') && tabEls().length === 2, tabState());
		check('... and closing a background tab leaves the active one', kitchenShowing(), tabState());

		await emitCommand('command:reopenClosedTab').catch(error => log(`        (emit failed: ${error})`));
		await waitFor('b.md to reopen', () => showing('tabs/b.md', 'Tabs fixture B'), 8000).catch(() => null);
		check('Reopen Closed Tab brings back the last tab closed', !!tabFor('tabs/b.md') && tabEls().length === 3
			&& showing('tabs/b.md', 'Tabs fixture B'), tabState());

		// Close everything, the sample last, so that reopening brings it back for the sections
		// after this one.
		for (const suffix of ['tabs/b.md', 'tabs/a.md', 'samples/kitchen-sink.md']) {
			tabFor(suffix)?.querySelector('.tab-close')?.click();
			await waitFor(`${suffix} to close`, () => !tabFor(suffix), 3000).catch(() => null);
		}
		await waitFor('the empty state', () => document.body.classList.contains('no-document'), 5000)
			.catch(() => null);
		check('closing every tab leaves none', tabEls().length === 0, tabState());
		check('... and shows the empty state', document.body.classList.contains('no-document')
			&& !document.querySelector('#markdown-body h1'), document.body.className);
		check('... and hides the tab strip', getComputedStyle(strip).display === 'none',
			getComputedStyle(strip).display);
		check('... and the title names no document', document.title === 'MarkReader'
			&& document.getElementById('doc-title').textContent === 'No document',
			`${document.title} / ${document.getElementById('doc-title').textContent}`);

		await emitCommand('command:reopenClosedTab').catch(error => log(`        (emit failed: ${error})`));
		await waitFor('the sample to reopen', () => kitchenShowing()
			&& document.querySelectorAll('.mermaid-block.rendered, .mermaid-block.failed').length >= 3, 45000)
			.catch(() => null);
		check('Reopen Closed Tab brings a document back from the empty state',
			kitchenShowing() && tabEls().length === 1 && !document.body.classList.contains('no-document'), tabState());
		check('... and the sample\'s images load again', await waitFor('badge.svg after reopen', () => {
			const img = Array.from(document.querySelectorAll('#markdown-body img'))
				.find(i => i.getAttribute('data-src')?.includes('badge.svg'));
			return img && img.complete && img.naturalWidth > 0;
		}, 8000).catch(() => false));

		log('');
		log('--- folder sidebar ---');
		// Drives the real Rust folder scanner and the real `folder:opened` event the dialog
		// would emit, just without the dialog.
		await invoke('open_folder', { root: smoke.root });
		await waitFor('sidebar list populated', () =>
			document.querySelectorAll('#file-list .file-entry').length > 0);

		const entries = Array.from(document.querySelectorAll('#file-list .file-entry'));
		const sidebar = {
			count: entries.length,
			active: entries.filter(e => e.classList.contains('active')).length,
			nodeModules: entries.filter(e => (e.title || '').includes('node_modules')).length,
		};
		check('tree scan finds sample + readme', sidebar.count >= 2, `${sidebar.count} files`);
		check('tree scan skips node_modules', sidebar.nodeModules === 0, `${sidebar.nodeModules} entries`);
		check('open document is marked active in sidebar', sidebar.active === 1, `${sidebar.active}`);

		const fileFilter = document.getElementById('file-filter');
		fileFilter.value = 'kitchen';
		fileFilter.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep(150);
		const filtered = document.querySelectorAll('#file-list .file-entry').length;
		check('sidebar filter narrows the list', filtered >= 1 && filtered < sidebar.count,
			`${filtered} of ${sidebar.count}`);

		fileFilter.value = '';
		fileFilter.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep(150);

		log('');
		log('--- tabs from the sidebar ---');
		/** The sidebar entry for a fixture under test/tmp/fixtures/tabs, re-queried: the list is redrawn. */
		const fileEntry = name => Array.from(document.querySelectorAll('#file-list .file-entry'))
			.find(e => (e.title || '').replace(/\\/g, '/').endsWith('test/tmp/fixtures/tabs/' + name));

		const entryB = fileEntry('b.md');
		entryB?.click();
		await waitFor('b.md from the sidebar', () => showing('tabs/b.md', 'Tabs fixture B'), 8000).catch(() => null);
		check('clicking a sidebar file opens it in a preview tab',
			!!entryB && showing('tabs/b.md', 'Tabs fixture B') && tabEls().length === 2
				&& activeTab()?.classList.contains('preview') === true, tabState());

		fileEntry('c.md')?.click();
		await waitFor('c.md from the sidebar', () => showing('tabs/c.md', 'Tabs fixture C'), 8000).catch(() => null);
		check('clicking another sidebar file replaces the preview tab',
			showing('tabs/c.md', 'Tabs fixture C') && tabEls().length === 2 && !tabFor('tabs/b.md')
				&& activeTab()?.classList.contains('preview') === true, tabState());

		const entryC = fileEntry('c.md');
		if (entryC) {
			mouse(entryC, 'dblclick');
		}
		await waitFor('c.md to be pinned', () => tabFor('tabs/c.md') && !tabFor('tabs/c.md').classList.contains('preview'), 3000)
			.catch(() => null);
		check('double-clicking a sidebar file keeps its tab',
			!!tabFor('tabs/c.md') && !tabFor('tabs/c.md').classList.contains('preview') && tabEls().length === 2,
			tabState());

		// Live reload of a tab that is not showing: the watcher's event only stores the text, so
		// listen for it here to know it has arrived before the tab is brought forward — otherwise
		// a late event would land on the showing tab and pass for the wrong reason.
		const changed = [];
		const handlerId = window.__TAURI_INTERNALS__.transformCallback(event => changed.push(event.payload));
		const eventId = await invoke('plugin:event|listen', {
			event: 'document:changed',
			target: { kind: 'Any' },
			handler: handlerId,
		}).catch(() => undefined);

		tabFor('samples/kitchen-sink.md')?.click();
		await waitFor('the sample to show again', () => kitchenShowing(), 8000).catch(() => null);
		const cPath = tabFor('tabs/c.md')?.title.split('\n')[0];
		const bgMarker = `Background reload check ${Date.now()}`;
		const bgAppended = await invoke('smoke_append', { path: cPath, text: '\n\n## ' + bgMarker + '\n' })
			.then(() => true).catch(error => String(error));
		const bgEvent = await waitFor('the watcher to report the background save',
			() => changed.some(doc => (doc?.text ?? '').includes(bgMarker)), 20000).catch(() => false);
		check('a save to a background tab reaches the window', bgAppended === true && bgEvent === true,
			`append: ${bgAppended}, events: ${changed.length}`);
		check('... without disturbing the tab that is showing', kitchenShowing()
			&& !(document.getElementById('markdown-body').textContent || '').includes(bgMarker), tabState());

		tabFor('tabs/c.md')?.click();
		const bgShown = await waitFor('the background save to show', () => showing('tabs/c.md', 'Tabs fixture C')
			&& Array.from(document.querySelectorAll('#markdown-body h2')).some(h => (h.textContent || '').includes(bgMarker)),
		5000).then(() => true, () => false);
		check('activating it shows the saved text', bgShown, tabState());
		if (eventId !== undefined) {
			await invoke('plugin:event|unlisten', { event: 'document:changed', eventId }).catch(() => undefined);
		}

		// The live reload section below expects the sample alone, showing, and settled.
		tabFor('tabs/c.md')?.querySelector('.tab-close')?.click();
		await waitFor('the sample to settle', () => kitchenShowing() && tabEls().length === 1
			&& document.querySelectorAll('.mermaid-block.rendered, .mermaid-block.failed').length >= 3, 45000)
			.catch(() => null);
		check('closing the last extra tab leaves the sample showing', kitchenShowing() && tabEls().length === 1, tabState());

		log('');
		log('--- live reload ---');
		// Appending to the open document has to come back as `document:changed` through the
		// file watcher, with the scroll position held.
		viewer.scrollTo({ top: 900 });
		await sleep(250);
		const scrollBefore = viewer.scrollTop;
		const marker = `Live reload check ${Date.now()}`;
		const appended = await invoke('smoke_append', {
			path: smoke.file,
			text: '\n\n## ' + marker + '\n',
		}).then(() => true).catch(error => String(error));
		check('append hook writes to the open document', appended === true, String(appended));

		const reloaded = await waitFor('the watcher to push the change', () =>
			Array.from(document.querySelectorAll('#markdown-body h2'))
				.some(h => (h.textContent || '').includes(marker)), 20000).catch(() => false);
		check('live reload picks up a save', reloaded === true);
		check('scroll position held across live reload',
			Math.abs(viewer.scrollTop - scrollBefore) <= 2,
			`${scrollBefore} -> ${viewer.scrollTop}`);
		check('outline rebuilt after live reload',
			Array.from(document.querySelectorAll('#toc-list .toc-entry'))
				.some(e => (e.textContent || '').includes(marker)));

		log('');
		log('--- settings ---');
		// A --smoke run keeps its settings beside the report, in the scratch directory the
		// runner wipes first, so this run necessarily started from the defaults. The runner
		// checks the file that the theme switch above should have written.
		check('stored settings injected before any page script ran', smoke.settingsInjected === true);
		check('a wiped scratch directory means no stored settings', smoke.injectedSettings === null,
			JSON.stringify(smoke.injectedSettings));
		check('the settings path was handed to the run', typeof smoke.settings === 'string',
			String(smoke.settings));

		log('');
		log('--- console errors ---');
		// Mermaid logs its own parse error for the deliberately broken diagram.
		const unexpected = (smoke.consoleErrors || []).filter(m =>
			!/mermaid|Parse error|Syntax error|No diagram type/i.test(m));
		check('no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
	} catch (error) {
		log(`  FAIL  harness error — ${error && error.stack ? error.stack : error}`);
		failures.push('harness error');
	}

	await invoke('smoke_report', { report: { lines, failures } });
})();
