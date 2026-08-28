// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Ambient declarations for browser APIs TypeScript's DOM lib doesn't cover yet, and for
 *  packages that ship no types.
 *--------------------------------------------------------------------------------------------*/

/**
 * CSS Custom Highlight API — used by the find bar to paint matches without touching
 * the DOM. Shipped in Chromium 105; not in TypeScript's DOM lib as of 5.x.
 */
declare class Highlight {
	constructor(...ranges: Range[]);
	add(range: Range): void;
	clear(): void;
	readonly size: number;
}

interface HighlightRegistry {
	set(name: string, highlight: Highlight): void;
	get(name: string): Highlight | undefined;
	delete(name: string): boolean;
	clear(): void;
}

interface CSS {
	highlights: HighlightRegistry;
}

declare namespace CSS {
	const highlights: HighlightRegistry;
}

/** `@vscode/markdown-it-katex` ships no type declarations. */
declare module '@vscode/markdown-it-katex' {
	import type MarkdownIt from 'markdown-it';
	const plugin: MarkdownIt.PluginWithOptions<Record<string, unknown>>;
	export default plugin;
}
