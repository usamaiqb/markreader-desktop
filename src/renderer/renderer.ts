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
import { startDesktopShell } from './shell';

const api = window.markreader;

const view = new DocumentView({
	root: document.getElementById('markdown-body')!,
	host: api,
});

startDesktopShell({ view, api });
