// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Bridge — installs `window.markreader`, the only interface the renderer sees.
 *
 *  Everything below is either an `invoke()` of a Rust command or a subscription to an event
 *  the Rust side emits. The renderer never imports Tauri directly, which is what allows
 *  `src/renderer/**` to run unchanged against a different host.
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { FolderPayload, MarkDocument, MarkReaderApi } from '../renderer/host';

export type { FolderPayload, MarkDocument, MarkReaderApi };

/**
 * `listen()` is asynchronous, but the renderer expects the synchronous
 * `subscribe -> unsubscribe function` shape the renderer expects. Registration is tracked so
 * start-up can wait for every listener to be live before the backend pushes anything
 * (see `frontend_ready` below) — otherwise the document opened from argv can race the
 * listeners and be dropped.
 */
const pendingRegistrations: Promise<unknown>[] = [];

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
	let unlisten: UnlistenFn | undefined;
	let cancelled = false;

	const registration = listen<T>(channel, event => handler(event.payload)).then(fn => {
		if (cancelled) {
			fn();
		} else {
			unlisten = fn;
		}
	});
	pendingRegistrations.push(registration);

	return () => {
		cancelled = true;
		unlisten?.();
	};
}

/**
 * The settings the backend read from disk and injected before any page script ran — see
 * `src-tauri/src/settings.rs`. Reading them synchronously is the point: the renderer applies
 * the stored theme on its first paint, rather than painting the default one and correcting
 * itself an `invoke()` round-trip later. `undefined` on a first run, or if what was stored
 * turned out to be unusable. The global is consumed on read, so nothing else can pick it up.
 */
function takeInjectedSettings(): Record<string, unknown> | undefined {
	const host = window as { __MARKREADER_SETTINGS__?: unknown };
	const injected = host.__MARKREADER_SETTINGS__;
	delete host.__MARKREADER_SETTINGS__;
	return typeof injected === 'object' && injected !== null && !Array.isArray(injected)
		? injected as Record<string, unknown>
		: undefined;
}

/**
 * Annotated with the shared contract rather than inferred from this object, so that dropping
 * or renaming a member here is a compile error instead of a silently narrower `window
 * .markreader` for the renderer to trip over.
 */
const api: MarkReaderApi = {
	// Desktop can do all three; an Android host will declare none of them.
	capabilities: {
		revealInFolder: true,
		windowBackground: true,
		watchesFiles: true,
	},

	openFileDialog: (): Promise<void> => invoke('open_file_dialog'),
	openFolderDialog: (): Promise<void> => invoke('open_folder_dialog'),
	openPath: (filePath: string): Promise<void> => invoke('open_document', { path: filePath }),
	readFile: async (filePath: string): Promise<MarkDocument | undefined> =>
		(await invoke<MarkDocument | null>('read_document', { path: filePath })) ?? undefined,
	openExternal: (url: string): Promise<void> => invoke('open_external', { url }),
	showInFolder: (filePath: string): Promise<void> => invoke('reveal_in_folder', { path: filePath }),
	setWindowBackground: (color: string): Promise<void> => invoke('set_window_background', { color }),

	settings: takeInjectedSettings(),
	saveSettings: (settings: Record<string, unknown>): Promise<void> =>
		invoke('save_settings', { settings }),

	/**
	 * A webview has no API for resolving a dropped `File` to a path: the paths arrive on the
	 * native drag-drop event instead, which is wired up at the bottom of this file. The
	 * renderer's DOM `drop` handler still calls this, and gets `undefined`.
	 */
	pathForFile: (_file: File): string | undefined => undefined,

	onDocumentOpened: (h: (doc: MarkDocument) => void) => subscribe('document:opened', h),
	onDocumentChanged: (h: (doc: MarkDocument) => void) => subscribe('document:changed', h),
	onFolderOpened: (h: (payload: FolderPayload) => void) => subscribe('folder:opened', h),
	onCommand: (channel: string, h: (payload: unknown) => void) => subscribe(channel, h),
};

Object.defineProperty(window, 'markreader', { value: api, enumerable: true });

// ------------------------------------------------------------------- native drag & drop

/**
 * With the webview's own drag-and-drop handling in place, the DOM never sees `dragover` or
 * `drop` for external files — the paths come from the runtime. The `drag-over` body class
 * the renderer's CSS uses is applied here so the visual feedback is unchanged.
 */
const MARKDOWN_PATTERN = /\.(md|markdown|mdown|mkdn|mkd|mdwn|mdtxt|mdtext|workbook)$/i;

void getCurrentWebview().onDragDropEvent(event => {
	const payload = event.payload;
	if (payload.type === 'enter' || payload.type === 'over') {
		document.body.classList.add('drag-over');
		return;
	}

	document.body.classList.remove('drag-over');
	if (payload.type !== 'drop') {
		return;
	}

	const dropped = payload.paths.find(p => MARKDOWN_PATTERN.test(p)) ?? payload.paths[0];
	if (dropped) {
		void api.openPath(dropped);
	}
});

// ----------------------------------------------------------------------------- hand-off

// Tells the backend the window can be shown and any start-up document flushed. Deferred by
// a macrotask so the renderer module (which runs right after this one) has registered its
// own listeners, then awaited so all of them are actually live on the Rust side.
setTimeout(() => {
	void Promise.allSettled(pendingRegistrations).then(() => invoke('frontend_ready'));
}, 0);
