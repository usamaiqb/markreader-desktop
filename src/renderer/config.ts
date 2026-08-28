// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  MarkReader — replaces VS Code's `MarkdownPreviewConfiguration` / `workspace.getConfiguration`.
 *--------------------------------------------------------------------------------------------*/

export type FrontMatterRenderStyle = 'hide' | 'codeBlock' | 'table';
export type ThemeMode = 'light' | 'dark' | 'system';

/** The markdown-it options VS Code exposes as settings. */
export interface MarkdownItConfig {
	readonly breaks: boolean;
	readonly linkify: boolean;
	readonly typographer: boolean;
}

export interface MarkReaderConfig extends MarkdownItConfig {
	readonly theme: ThemeMode;
	readonly frontMatter: FrontMatterRenderStyle;
	/** Session-only, both of them — see `sessionOnly` below. */
	readonly math: boolean;
	readonly mermaid: boolean;
	readonly showToc: boolean;
	readonly wordWrap: boolean;
	readonly fontSize: number;
	readonly lineHeight: number;
	readonly fontFamily: string;
	/** KaTeX macro definitions, as in `markdown.math.macros`. */
	readonly mathMacros: Readonly<Record<string, string>>;
}

export const defaultConfig: MarkReaderConfig = {
	// markdown-it — same defaults as VS Code's markdown.preview.* settings
	breaks: false,
	linkify: true,
	typographer: false,

	theme: 'system',
	frontMatter: 'table',
	math: true,
	mermaid: true,
	showToc: true,
	wordWrap: true,
	fontSize: 14,
	lineHeight: 22,
	fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif',
	mathMacros: {},
};

let current: MarkReaderConfig = defaultConfig;

export function getConfig(): MarkReaderConfig {
	return current;
}

export type ConfigListener = (config: MarkReaderConfig) => void;

const listeners: ConfigListener[] = [];

/**
 * Notified after every `setConfig`. The host uses this to persist the configuration — the
 * renderer itself has nowhere to put it, and deliberately doesn't know where it ends up.
 */
export function onConfigChanged(listener: ConfigListener): void {
	listeners.push(listener);
}

export function setConfig(patch: Partial<MarkReaderConfig>): MarkReaderConfig {
	current = { ...current, ...patch };
	for (const listener of listeners) {
		listener(current);
	}
	return current;
}

/**
 * Narrow view handed to the engine, mirroring what `#getConfig()` returned in
 * the original `MarkdownItEngine`.
 */
export function getMarkdownItConfig(): MarkdownItConfig {
	const { breaks, linkify, typographer } = current;
	return { breaks, linkify, typographer };
}

// ------------------------------------------------------------------ stored settings

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function oneOf<T extends string>(allowed: readonly T[]) {
	return (value: unknown): T | undefined =>
		typeof value === 'string' && (allowed as readonly string[]).includes(value)
			? value as T
			: undefined;
}

function inRange(min: number, max: number) {
	return (value: unknown): number | undefined =>
		typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
			? value
			: undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'string') {
			record[key] = entry;
		}
	}
	return record;
}

/**
 * One validator per setting. Everything that reaches `parseConfig` came off disk and may have
 * been hand-edited, written by an older version, or corrupted — so each value is checked on the
 * way in rather than spread over the defaults on trust. The table is exhaustive by
 * construction, so a setting cannot be added without deciding how it is validated; what does
 * and does not reach the disk is `sessionOnly` below.
 */
const validators: { readonly [K in keyof MarkReaderConfig]: (value: unknown) => MarkReaderConfig[K] | undefined } = {
	breaks: asBoolean,
	linkify: asBoolean,
	typographer: asBoolean,
	theme: oneOf(['light', 'dark', 'system'] as const),
	frontMatter: oneOf(['hide', 'codeBlock', 'table'] as const),
	math: asBoolean,
	mermaid: asBoolean,
	showToc: asBoolean,
	wordWrap: asBoolean,
	// Bounds, not just types: a zero or negative size would render an unreadable document with
	// no way to fix it from inside the app.
	fontSize: inRange(6, 96),
	lineHeight: inRange(8, 200),
	fontFamily: nonEmptyString,
	mathMacros: stringRecord,
};

/**
 * Settings that deliberately do not survive a restart.
 *
 * Turning math or mermaid off is how you get at the source of a formula or a diagram that is
 * rendering badly — a per-document escape hatch, not a preference. Persisting it would leave
 * every later document silently unrendered with nothing on screen to say why: the View menu
 * builds plain items, not check items (see `menu.rs`), so the state is invisible once you have
 * forgotten setting it. Both start on, every launch.
 *
 * Skipped on the way in as well as on the way out, so a value written by an older build is
 * ignored and then dropped by the next write.
 */
const sessionOnly: ReadonlySet<keyof MarkReaderConfig> = new Set(['math', 'mermaid']);

/** The settings that travel to disk and back: everything validated, less the session-only ones. */
const persistedKeys = (Object.keys(validators) as (keyof MarkReaderConfig)[])
	.filter(key => !sessionOnly.has(key));

/**
 * Turns stored JSON into a patch for `setConfig`. Unknown keys are dropped and invalid values
 * fall back to the default for that one setting, so a single bad entry costs only itself.
 */
export function parseConfig(raw: unknown): Partial<MarkReaderConfig> {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return {};
	}

	const stored = raw as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	for (const key of persistedKeys) {
		if (!(key in stored)) {
			continue;
		}
		const validate = validators[key] as (value: unknown) => unknown;
		const value = validate(stored[key]);
		if (value !== undefined) {
			patch[key] = value;
		}
	}
	return patch as Partial<MarkReaderConfig>;
}

/** The persisted settings as a plain, JSON-safe object, ready to hand to the host. */
export function serializeConfig(): Record<string, unknown> {
	const settings: Record<string, unknown> = {};
	for (const key of persistedKeys) {
		// The macro table is the one setting held as an object, and is copied so the host
		// cannot reach back into the live configuration through it.
		settings[key] = key === 'mathMacros' ? { ...current.mathMacros } : current[key];
	}
	return settings;
}
