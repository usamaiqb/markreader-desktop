// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Minimal path helpers. The renderer is bundled for the browser platform, so Node's `path`
 *  isn't available here.
 *--------------------------------------------------------------------------------------------*/

/** Directory portion of an absolute path. Accepts `/` or `\` separators. */
export function dirname(p: string): string {
	const normalized = p.replace(/\\/g, '/');
	const idx = normalized.lastIndexOf('/');
	if (idx <= 0) {
		return normalized.slice(0, idx + 1) || '/';
	}
	return normalized.slice(0, idx);
}

export function basename(p: string): string {
	const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
	return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function extname(p: string): string {
	const base = basename(p);
	const idx = base.lastIndexOf('.');
	return idx <= 0 ? '' : base.slice(idx);
}

/**
 * Joins `base` with a relative `rel` and collapses `.` / `..` segments.
 * Always returns forward slashes; the host normalizes for its filesystem.
 */
export function resolvePath(base: string, rel: string): string {
	const baseNorm = base.replace(/\\/g, '/').replace(/\/+$/, '');
	const relNorm = rel.replace(/\\/g, '/');

	const driveMatch = /^([a-z]:)/i.exec(baseNorm);
	const drive = driveMatch ? driveMatch[1] : '';
	const rooted = baseNorm.startsWith('/');

	const segments = baseNorm.slice(drive.length).split('/').filter(s => s.length > 0);

	for (const segment of relNorm.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			segments.pop();
		} else {
			segments.push(segment);
		}
	}

	const joined = segments.join('/');
	if (drive) {
		return `${drive}/${joined}`;
	}
	return rooted ? `/${joined}` : joined;
}

export function isMarkdownPath(p: string): boolean {
	return /\.(md|markdown|mdown|mkdn|mkd|mdwn|mdtxt|mdtext|workbook)$/i.test(p);
}
