// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The documents a `--smoke` run opens, shared by both runners — `smoke.mjs` against the dev
 *  build, `verify-packaged.mjs` against the release binary. They run the same assertions, so
 *  they have to start from the same documents; this used to be written out in each, and the
 *  packaged copy fell behind.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Recreates `tmp` with fresh copies of `samples/` and `test/fixtures/` — the live-reload checks
 * append to them, so `samples/kitchen-sink.md` itself is never modified — and returns the
 * paths to pass on the command line, in order.
 *
 * Two documents, so the start-up path for several is exercised: each gets a tab, and the last
 * — the sample, which every section after the tab checks reads — is left showing.
 */
export async function prepareSmokeDocuments(root, tmp) {
	await fs.rm(tmp, { recursive: true, force: true });
	await fs.mkdir(tmp, { recursive: true });
	await fs.cp(path.join(root, 'samples'), path.join(tmp, 'samples'), { recursive: true });

	// The tab checks need documents to link between, outside the sample's folder rather than
	// inside it: the sample's folder is a resource root while it is active, so an image in a
	// subfolder of it would load whether or not the roots follow the active tab. The link that
	// reaches them is added to the copy, so the sample itself stays a plain showcase.
	await fs.cp(path.join(root, 'test', 'fixtures'), path.join(tmp, 'fixtures'), { recursive: true });
	const sample = path.join(tmp, 'samples', 'kitchen-sink.md');
	await fs.appendFile(sample, '\n\nSee also the [tabs fixture](../fixtures/tabs/a.md).\n');

	// A session from a "previous run" for the app to restore, where a --smoke run keeps it:
	// one tab that is still there, and one whose file has gone since, which has to be skipped.
	await fs.writeFile(path.join(tmp, 'session.json'), JSON.stringify(previousSession(tmp), null, '\t'));

	return [path.join(tmp, 'fixtures', 'tabs', 'b.md'), sample];
}

function previousSession(tmp) {
	return {
		version: 1,
		tabs: [
			{
				path: path.join(tmp, 'fixtures', 'tabs', 'a.md'),
				viewerId: 'markdown',
				preview: false,
				viewState: { scrollTop: 300 },
			},
			{ path: path.join(tmp, 'fixtures', 'tabs', 'deleted-since.md'), viewerId: 'markdown', preview: false },
		],
		active: 0,
	};
}

/**
 * What is wrong with the session a run saved, or nothing if it is fine: the run ends with the
 * sample open, so the sample has to be among the tabs written, and the file the previous
 * session listed but that had gone must not have come back.
 */
export async function checkSavedSession(file) {
	const text = await fs.readFile(file, 'utf8').catch(() => undefined);
	if (text === undefined) {
		return 'nothing was written to ' + file;
	}
	let session;
	try {
		session = JSON.parse(text);
	} catch (error) {
		return file + ' is not valid JSON: ' + error.message;
	}
	if (session.version !== 1 || !Array.isArray(session.tabs)) {
		return file + ' is not a saved tab session';
	}
	const paths = session.tabs.map(tab => String(tab.path).replace(/\\/g, '/'));
	if (!paths.some(p => p.endsWith('/samples/kitchen-sink.md'))) {
		return 'the sample is not among the saved tabs: ' + JSON.stringify(paths);
	}
	if (paths.some(p => p.endsWith('/deleted-since.md'))) {
		return 'a tab whose file had gone was saved again';
	}
	return undefined;
}
