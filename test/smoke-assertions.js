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
			strayErrorSvgs: document.querySelectorAll('body > svg[id^="mr-mermaid-"]').length,
		};
		check('two valid diagrams rendered to SVG', mermaid.rendered === 2, JSON.stringify(mermaid));
		check('broken diagram degrades to error state', mermaid.failed === 1, JSON.stringify(mermaid));
		check('no stray mermaid error graphics leaked into body', mermaid.strayErrorSvgs === 0);

		log('');
		log('--- outline navigation ---');
		const scrollBeforeNav = window.scrollY;
		document.querySelectorAll('#toc-list .toc-entry')[8]?.click();
		await sleep(700);
		const navigated = { before: scrollBeforeNav, after: window.scrollY };
		check('clicking an outline entry scrolls the document',
			navigated.after > navigated.before, JSON.stringify(navigated));

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
		window.scrollTo({ top: 0 });

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

		log('');
		log('--- panes ---');
		document.getElementById('btn-toggle-sidebar').click();
		check('sidebar toggles on', document.body.classList.contains('has-sidebar'));
		check('outline still on', document.body.classList.contains('has-outline'));

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
		log('--- live reload ---');
		// Appending to the open document has to come back as `document:changed` through the
		// file watcher, with the scroll position held.
		window.scrollTo({ top: 900 });
		await sleep(250);
		const scrollBefore = window.scrollY;
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
			Math.abs(window.scrollY - scrollBefore) <= 2,
			`${scrollBefore} -> ${window.scrollY}`);
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
