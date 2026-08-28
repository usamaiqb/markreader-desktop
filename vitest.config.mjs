// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Vitest config for the frontend unit tests.
 *
 *  The DOM smoke suite stays the integration gate; these are the fast, headless unit tests
 *  for the renderer's pure modules (engine, slugify, paths, util). Node's `navigator` is
 *  fine here — the only place it matters is the `mdr://` origin in util.ts, and both
 *  spellings are asserted in the tests.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
	},
});
