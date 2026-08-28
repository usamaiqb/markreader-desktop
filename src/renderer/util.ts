/*---------------------------------------------------------------------------------------------
 *  SPDX-License-Identifier: GPL-3.0-only
 *  SPDX-FileCopyrightText: 2026 DigiGate
 *  SPDX-FileCopyrightText: Microsoft Corporation — MIT, see licenses/vscode.txt
 *
 *  Path and URI helpers. `escapeAttribute` and `escapeHtml` come from VS Code's
 *  `markdown-language-features/src/util/dom.ts`; the `mdr://` helpers below are
 *  MarkReader's own. See licenses/NOTICE.md.
 *--------------------------------------------------------------------------------------------*/

export function escapeAttribute(value: string | { toString(): string }): string {
	return String(value).replace(/"/g, '&quot;');
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Replaces VS Code's `resourceProvider.asWebviewUri()`.
 *
 * Local files can't be loaded straight from a `file://` page without also handing the
 * document's own relative asset resolution over to `<base href>`, which would break the
 * app shell's paths. Instead every local reference is rewritten to the custom `mdr://`
 * scheme that the host serves from disk.
 *
 * WebView2 supports no non-standard schemes, so on Windows the runtime maps
 * `mdr://localhost/...` onto `http://mdr.localhost/...` and only intercepts the latter.
 * The Rust protocol handler is handed the `mdr://` form on every platform; the origin the
 * page has to request is the only thing that differs.
 */
const MDR_ORIGIN = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
	? 'http://mdr.localhost'
	: 'mdr://localhost';

export function asLocalResourceUri(absolutePath: string): string {
	// Normalize Windows separators and ensure a leading slash so the URL parses.
	let p = absolutePath.replace(/\\/g, '/');
	if (!p.startsWith('/')) {
		p = '/' + p;
	}
	return MDR_ORIGIN + p.split('/').map(encodeURIComponent).join('/');
}

/** Inverse of {@link asLocalResourceUri}. */
export function localResourceUriToPath(url: string): string | undefined {
	const prefix = MDR_ORIGIN + '/';
	if (!url.startsWith(prefix)) {
		return undefined;
	}
	const decoded = url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
	// Restore `C:/...` style paths; POSIX paths keep their leading slash.
	return /^[a-z]:/i.test(decoded) ? decoded : '/' + decoded;
}

export function isAbsolutePath(p: string): boolean {
	return p.startsWith('/') || /^[a-z]:[\\/]/i.test(p);
}
