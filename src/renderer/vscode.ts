// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The `vscode` module, as far as the files copied verbatim from VS Code use it.
 *
 *  Those files import `vscode` as written upstream, and `paths` in tsconfig.json points that
 *  import here, so they stay byte-identical. It holds only what a copied file uses. Today that
 *  is one type, which compiles away, so nothing resolves `vscode` at runtime; a copied file
 *  that calls a real API would also need it resolved by the bundlers.
 *--------------------------------------------------------------------------------------------*/

/** Used as a type by `markdown-language-features/util/dom.ts`. */
export interface Uri {
	toString(): string;
}
