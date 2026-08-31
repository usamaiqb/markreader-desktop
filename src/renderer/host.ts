// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The host contract — the only thing `src/renderer/**` may assume about the app around it.
 *
 *  Two hosts implement this: the Tauri bridge in `src/bridge/bridge.ts`, and (from D2) an
 *  Android WebView. `DocumentHost` is the narrow half the shareable document module sees;
 *  `MarkReaderApi` adds the parts only a desktop shell uses.
 *
 *  ## The path space contract
 *
 *  **Paths crossing this interface are opaque to the renderer.** The host decides what a path
 *  means; the renderer only does string maths on it (`paths.ts`) and hands the result back.
 *  Desktop passes filesystem paths. Android passes `/saf/<token>/…`, where `<token>` names one
 *  picked SAF tree — exactly one host-side class knows that, and nothing in `src/renderer/**`
 *  does. This is load-bearing for both hosts, which is why it is written here rather than
 *  assumed.
 *
 *  What a host guarantees:
 *
 *  1. **`/` separates segments.** A host may also emit `\`; the renderer normalizes it away.
 *  2. **Every path a host emits is absolute** — `MarkDocument.path`, `FolderPayload.root` and
 *     `TreeEntry.path` alike. Absolute means a leading `/` or an `X:` drive prefix.
 *  3. **`<dir>/<segment>` names the child and `..` removes the last segment.** That is the
 *     whole of the renderer's arithmetic. A document at `/saf/t7/doc.md` referencing
 *     `assets/x.svg` comes back as `/saf/t7/assets/x.svg`, unaided — no resolver callback, no
 *     async hop.
 *  4. **What the host emits, it can take back.** Every path the renderer returns is one the
 *     host gave it, or that path with segments appended or removed.
 *
 *  What the renderer guarantees in return: it parses no meaning out of a path. No drive-letter
 *  semantics, no filesystem access, no assumption that a path names a file at all.
 *  `test/unit/opaque-paths.test.ts` enforces this by running the same cases over three
 *  unrelated path spaces; if one of them ever needs a special case, this contract is broken.
 *
 *  **One exception, and it is the host's to absorb.** A document containing an explicit
 *  `file:` link is converted to a path by `engine.ts` (`#toResourceUri`) — a filesystem
 *  concept a virtual path space has no answer for. Such a link resolves to something an
 *  Android host cannot serve, so it 404s. It degrades rather than throwing, and it is the only
 *  place the renderer assumes what a path means.
 *--------------------------------------------------------------------------------------------*/

export interface MarkDocument {
	readonly path: string;
	readonly text: string;
}

export interface TreeEntry {
	readonly path: string;
	readonly relativePath: string;
	readonly name: string;
}

export interface FolderPayload {
	readonly root: string;
	readonly entries: readonly TreeEntry[];
}

/**
 * What a host can and cannot do, declared rather than probed.
 *
 * Optional methods already let the document degrade instead of throwing, but "is this method
 * present" is a poor question for a shell to ask before drawing a control — `pathForFile`
 * returns `undefined` on Tauri and is present regardless, which is the precedent. A host
 * states its capabilities; anything it does not state is absent.
 *
 * Android has none of these three: no file manager to reveal into, no native window behind
 * the page, and no file watcher on a SAF tree.
 */
export interface HostCapabilities {
	/** `showInFolder` will actually reveal the file. */
	readonly revealInFolder: boolean;
	/** `setWindowBackground` will actually paint something. */
	readonly windowBackground: boolean;
	/** The host pushes `onDocumentChanged` when a file changes underneath it. */
	readonly watchesFiles: boolean;
}

export const NO_CAPABILITIES: HostCapabilities = {
	revealInFolder: false,
	windowBackground: false,
	watchesFiles: false,
};

/**
 * What the document module needs from its host. Optional members are capabilities: a host
 * that cannot do one omits it, and the document degrades instead of throwing. Android has no
 * file manager to reveal into, so `showInFolder` is the first of these.
 */
export interface DocumentHost {
	/** Absent on a host that declares nothing, which is read as "none of them". */
	readonly capabilities?: HostCapabilities;
	/** Open a URL outside the app. Hosts must allowlist the schemes they will act on. */
	openExternal(url: string): Promise<void>;
	/** Ask the host to open another document; it answers with an `onDocumentOpened` event. */
	openPath(filePath: string): Promise<void>;
	readFile(filePath: string): Promise<MarkDocument | undefined>;
	showInFolder?(filePath: string): Promise<void>;
}

/** The full surface the desktop bridge installs as `window.markreader`. */
export interface MarkReaderApi extends DocumentHost {
	openFileDialog(): Promise<void>;
	openFolderDialog(): Promise<void>;
	setWindowBackground?(color: string): Promise<void>;
	/** Settings from the previous run, already available when this module first runs. */
	readonly settings: Record<string, unknown> | undefined;
	saveSettings(settings: Record<string, unknown>): Promise<void>;
	pathForFile(file: File): string | undefined;
	onDocumentOpened(h: (doc: MarkDocument) => void): () => void;
	onDocumentChanged(h: (doc: MarkDocument) => void): () => void;
	onFolderOpened(h: (payload: FolderPayload) => void): () => void;
	onCommand(channel: string, h: (payload: unknown) => void): () => void;
}

/** A host that declares nothing can do nothing optional. */
export function capabilitiesOf(host: DocumentHost): HostCapabilities {
	return host.capabilities ?? NO_CAPABILITIES;
}

declare global {
	interface Window {
		readonly markreader: MarkReaderApi;
	}
}
