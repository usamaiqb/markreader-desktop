// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  highlight.js ships declarations for its core (`lib/core`) but not for the individual
 *  language modules, which `src/renderer/highlight.ts` imports one by one. Each of them
 *  default-exports a language definition function.
 *--------------------------------------------------------------------------------------------*/

declare module 'highlight.js/lib/languages/*' {
	const language: import('highlight.js').LanguageFn;
	export default language;
}
