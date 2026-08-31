// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Build script for the frontend. Two bundles:
 *    - renderer (browser, esm+split)  -> out/renderer/renderer.js (+ mermaid chunk)
 *    - css                            -> out/renderer/css/katex.css
 *
 *  The renderer is ESM with code splitting so `import('mermaid')` stays a lazy chunk —
 *  mermaid is ~2.5MB and most documents don't contain a diagram.
 *
 *  The entry point is `src/bridge/entry.ts`, which installs the `window.markreader` bridge
 *  and then pulls in the untouched renderer. `out/renderer` is what Tauri bundles as
 *  `frontendDist`; the backend lives in `src-tauri/` and is built by cargo.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const root = import.meta.dirname;
const out = path.join(root, 'out');

/** Fonts and images get inlined so the app stays self-contained under a strict CSP. */
const assetLoaders = {
	'.woff': 'dataurl',
	'.woff2': 'dataurl',
	'.ttf': 'dataurl',
	'.eot': 'dataurl',
	'.svg': 'dataurl',
	'.png': 'dataurl',
};

const shared = {
	bundle: true,
	sourcemap: production ? false : 'linked',
	minify: production,
	logLevel: 'info',
	define: {
		'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
	},
};

const configs = [
	{
		name: 'renderer',
		...shared,
		// Named entry so the output is `renderer.js`, which index.html loads.
		entryPoints: { renderer: path.join(root, 'src/bridge/entry.ts') },
		outdir: path.join(out, 'renderer'),
		platform: 'browser',
		format: 'esm',
		splitting: true,
		target: 'chrome130',
		loader: assetLoaders,
	},
	{
		name: 'css',
		...shared,
		entryPoints: {
			'css/katex': path.join(root, 'node_modules/katex/dist/katex.min.css'),
		},
		outdir: path.join(out, 'renderer'),
		platform: 'browser',
		loader: assetLoaders,
		// KaTeX ships absolute-looking font references; keep esbuild resolving them
		// relative to the stylesheet.
		external: [],
	},
];

/** Copies index.html and the hand-written CSS, which don't need bundling. */
async function copyStatic() {
	const rendererOut = path.join(out, 'renderer');
	await fs.mkdir(path.join(rendererOut, 'css'), { recursive: true });
	await fs.copyFile(
		path.join(root, 'src/renderer/index.html'),
		path.join(rendererOut, 'index.html'));

	for (const file of ['markdown.css', 'highlight.css', 'theme.css', 'document-overrides.css', 'app.css']) {
		await fs.copyFile(
			path.join(root, 'src/renderer/css', file),
			path.join(rendererOut, 'css', file));
	}
}

await fs.rm(out, { recursive: true, force: true });
await copyStatic();

if (watch) {
	for (const { name, ...config } of configs) {
		const ctx = await esbuild.context(config);
		await ctx.watch();
		console.log(`[watch] ${name}`);
	}
	// Re-copy static files when they change.
	const staticDir = path.join(root, 'src/renderer');
	const { watch: fsWatch } = await import('node:fs');
	fsWatch(staticDir, { recursive: true }, (_event, filename) => {
		if (filename && /\.(html|css)$/i.test(filename)) {
			void copyStatic().then(() => console.log(`[watch] copied ${filename}`));
		}
	});
	console.log('[watch] waiting for changes…');
} else {
	for (const { name: _name, ...config } of configs) {
		await esbuild.build(config);
	}
	console.log('build complete');
}
