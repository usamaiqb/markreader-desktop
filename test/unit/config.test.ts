// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the configuration store and, mainly, for what it accepts off disk
 *  (src/renderer/config.ts).
 *
 *  `settings.json` is a plain file a user can edit and an older build may have written, so
 *  `parseConfig` is the boundary that has to hold: one bad value must cost only itself.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	defaultConfig,
	getConfig,
	onConfigChanged,
	parseConfig,
	serializeConfig,
	setConfig,
} from '../../src/renderer/config';

describe('parseConfig', () => {
	it('accepts a full round-trip of the persisted configuration', () => {
		const persisted = { ...defaultConfig } as Record<string, unknown>;
		delete persisted.math;
		delete persisted.mermaid;
		expect(parseConfig(serializeConfig())).toEqual(persisted);
	});

	it('neither stores nor restores the session-only settings', () => {
		setConfig({ math: false, mermaid: false });
		const stored = serializeConfig();
		expect(stored).not.toHaveProperty('math');
		expect(stored).not.toHaveProperty('mermaid');

		// A value left behind by an older build is ignored rather than applied, so both
		// features come back on at the next launch.
		expect(parseConfig({ math: false, mermaid: false, theme: 'dark' })).toEqual({ theme: 'dark' });
		setConfig({ math: true, mermaid: true });
	});

	it('keeps known settings and drops unknown ones', () => {
		expect(parseConfig({ theme: 'dark', wordWrap: false, nonsense: 1 })).toEqual({
			theme: 'dark',
			wordWrap: false,
		});
	});

	it('drops a setting with the wrong type but keeps its neighbours', () => {
		expect(parseConfig({ theme: 'dark', wordWrap: 'yes', breaks: true })).toEqual({
			theme: 'dark',
			breaks: true,
		});
	});

	it('rejects a theme or front-matter style outside the allowed set', () => {
		expect(parseConfig({ theme: 'solarized', frontMatter: 'inline' })).toEqual({});
	});

	it('rejects out-of-range and non-finite numbers', () => {
		expect(parseConfig({ fontSize: 0 })).toEqual({});
		expect(parseConfig({ fontSize: -14 })).toEqual({});
		expect(parseConfig({ fontSize: 1e6 })).toEqual({});
		expect(parseConfig({ lineHeight: Number.NaN })).toEqual({});
		expect(parseConfig({ fontSize: 18 })).toEqual({ fontSize: 18 });
	});

	it('rejects an empty font family', () => {
		expect(parseConfig({ fontFamily: '   ' })).toEqual({});
		expect(parseConfig({ fontFamily: 'Consolas' })).toEqual({ fontFamily: 'Consolas' });
	});

	it('keeps only the string entries of the math macro table', () => {
		expect(parseConfig({ mathMacros: { RR: '\\mathbb{R}', bad: 42 } })).toEqual({
			mathMacros: { RR: '\\mathbb{R}' },
		});
		expect(parseConfig({ mathMacros: ['not', 'a', 'table'] })).toEqual({});
	});

	it('treats anything that is not an object as nothing stored', () => {
		// What the host hands over on a first run, or when the stored file was unusable.
		expect(parseConfig(undefined)).toEqual({});
		expect(parseConfig(null)).toEqual({});
		expect(parseConfig('{"theme":"dark"}')).toEqual({});
		expect(parseConfig([{ theme: 'dark' }])).toEqual({});
	});
});

describe('setConfig', () => {
	it('notifies listeners with the merged configuration', () => {
		const seen: string[] = [];
		onConfigChanged(config => seen.push(config.theme));

		setConfig({ theme: 'dark' });
		setConfig({ wordWrap: false });

		// Both changes notify, and the second one still reports the theme set by the first.
		expect(seen).toEqual(['dark', 'dark']);
		expect(getConfig().wordWrap).toBe(false);
	});
});

describe('serializeConfig', () => {
	it('returns a plain object that does not alias the live config', () => {
		setConfig({ mathMacros: { RR: '\\mathbb{R}' } });
		const settings = serializeConfig();

		(settings.mathMacros as Record<string, string>).RR = 'tampered';
		expect(getConfig().mathMacros.RR).toBe('\\mathbb{R}');
		expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
	});
});
