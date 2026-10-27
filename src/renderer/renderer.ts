// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Composition root for the desktop app: wire the shareable document module to the desktop
 *  chrome, and get out of the way.
 *
 *  This file used to be the whole renderer. It is split in two now — `document.ts` is the half
 *  an Android WebView will load, `shell.ts` is the half only this app has. The only reason
 *  this third file exists is that something has to introduce them, and neither should know how
 *  the other was constructed.
 *--------------------------------------------------------------------------------------------*/

import { DocumentView } from './document';
import type { DocumentHost } from './host';
import { startDesktopShell, type DesktopShell } from './shell';

const api = window.markreader;

/**
 * The view's host is the bridge, except that a link opens a tab — and tabs are the shell's,
 * which needs the view before it exists. Hence the late binding: no link can be clicked
 * before the shell is up.
 */
let shell: DesktopShell | undefined;
const host: DocumentHost = {
	capabilities: api.capabilities,
	openExternal: url => api.openExternal(url),
	openPath: (filePath, options) => shell?.openPath(filePath, options) ?? api.openPath(filePath),
	readFile: filePath => api.readFile(filePath),
	showInFolder: async filePath => api.showInFolder?.(filePath),
};

const view = new DocumentView({
	root: document.getElementById('markdown-body')!,
	host,
	scroller: document.getElementById('viewer')!,
});

shell = startDesktopShell({ view, api });
