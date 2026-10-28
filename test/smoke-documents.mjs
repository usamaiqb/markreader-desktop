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

	return [path.join(tmp, 'fixtures', 'tabs', 'b.md'), sample];
}
