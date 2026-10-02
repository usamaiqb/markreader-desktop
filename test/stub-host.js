// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

// The stub host's script, loaded by stub-host.html. A file of its own rather than an inline
// `<script>`, because the page carries the app's CSP and `script-src 'self'` blocks inline
// scripts. jsdom ignores CSP, which is why `verify:esm` checks for this rather than relying on
// the render check to notice.

import { DocumentView } from './document.js';
import { setResourceOrigin } from './util.js';
import { setConfig } from './config.js';

// Document resources are same-origin here, as they are on Android — so the origin is
// the page's own and `readFile` is an ordinary fetch rather than a second bridge.
setResourceOrigin(location.origin);

const params = new URLSearchParams(location.search);
const SAMPLE = params.get('doc') ?? 'kitchen-sink.md';
const THEME = params.get('theme') === 'light' ? 'light' : 'dark';

/**
 * The fake host. Everything the document module is allowed to assume about the app
 * around it, and nothing else — no capabilities, so this also exercises the degrade
 * paths a WebView host will take.
 */
const host = {
	capabilities: { revealInFolder: false, windowBackground: false, watchesFiles: false },

	async readFile(filePath) {
		const response = await fetch(filePath);
		if (!response.ok) {
			return undefined;
		}
		return { path: filePath, text: await response.text() };
	},

	async openPath(filePath) {
		const doc = await this.readFile(filePath);
		if (doc) {
			view.setDocument(doc, { preserveScroll: false });
		}
	},

	async openExternal(url) {
		console.log('[stub] openExternal', url);
	},
};

const view = new DocumentView({
	root: document.getElementById('markdown-body'),
	host,
});

// Whatever a real host would draw its chrome from, printed instead. A shell subscribes
// to exactly these; this proves they fire without one.
view.on('headings', headings => console.log(`[stub] ${headings.length} headings`));
view.on('activeHeading', slug => console.log('[stub] active heading', slug));
view.on('find', state => console.log('[stub] find', state));
view.on('theme', state => console.log('[stub] theme', state));
view.on('document', doc => console.log('[stub] document', doc?.path));

setConfig({ theme: THEME });
view.applyTheme();
view.setWordWrap(true);

const documentPath = `${location.pathname.replace(/\/[^/]*$/, '')}/samples/${SAMPLE}`;
await host.openPath(documentPath);

// Read by the automated check, which waits for it rather than guessing at timing.
window.__STUB_READY__ = true;
