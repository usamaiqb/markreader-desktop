// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The unbundled build: our code as plain ES modules, libraries as vendored single files.
 *
 *  `build.mjs` produces the bundle Tauri ships today. This produces the artifact Android will
 *  load, and the point of having both is that they are the *same source*. "Works bundled,
 *  breaks unbundled" is a whole class of bug — a bare specifier a bundler resolves and a
 *  browser does not, a CommonJS package that only ever worked because something converted it —
 *  and it is a class we would otherwise discover on a device.
 *
 *  Three steps:
 *
 *    1. `tsc` emits `src/renderer/**` one file in, one file out, so the shipped renderer stays
 *       near line-for-line with the source and is debuggable as itself.
 *    2. Each library is prebuilt into one self-contained ESM file under `vendor/`. Not copied:
 *       almost none of them ship something a browser can load directly. See VENDOR below.
 *    3. A rewrite pass over the emitted JS points every import at a real file — adding the
 *       `.js` extension `tsc` does not, and swapping bare specifiers for vendored paths.
 *
 *  Source keeps the upstream specifier (`import 'markdown-it'`), so the ported VS Code files
 *  stay diffable against the vscode repo. Only the emitted output names vendored paths.
 *
 *  Run with:  npm run build:esm
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
const out = path.join(root, 'out', 'renderer-esm');

/**
 * What each library becomes, and why it is built rather than copied.
 *
 * The uniform answer is "one self-contained ESM file per library", because the alternatives
 * are all worse in a different way for each one:
 *
 *   - `@vscode/markdown-it-katex` ships CommonJS only, with no ESM build at all. It must not
 *     be built with `katex` external: esbuild then leaves a `__require("katex")` shim whose
 *     body throws in a browser, which builds clean and fails at the first document with math.
 *     So KaTeX is baked in, which is why this file is the big one. Nothing else imports katex
 *     directly, so nothing is duplicated.
 *   - `highlight.js` ships `es/` entry points, but they re-export the CommonJS in `lib/`.
 *     Our own `highlight.ts` is the aggregation point — core plus 55 languages — so that is
 *     what gets built.
 *   - `mermaid` ships ESM split across 40-odd chunks. Flattening it loses its internal lazy
 *     loading of diagram types, but the whole of mermaid is *already* behind one dynamic
 *     `import()` here, so what is lost is a second tier of laziness inside a chunk that most
 *     documents never fetch.
 *   - `markdown-it`, `yaml` and `dompurify` do ship usable browser ESM, and are built anyway
 *     for consistency: one rule, one place to look, no per-library archaeology later.
 */
const VENDOR = [
	{ file: 'markdown-it.js', specifier: 'markdown-it' },
	{ file: 'markdown-it-katex.js', specifier: '@vscode/markdown-it-katex' },
	{ file: 'yaml.js', specifier: 'yaml' },
	{ file: 'purify.js', specifier: 'dompurify' },
	{ file: 'mermaid.js', specifier: 'mermaid' },
	{ file: 'highlight.js', path: path.join(root, 'src/renderer/highlight.ts') },
];

/**
 * Bare specifier -> vendored file, as a path from the output root. Anything imported by our
 * code and not named here fails the build, rather than shipping an import the browser cannot
 * resolve.
 */
const SPECIFIERS = new Map([
	['markdown-it', 'vendor/markdown-it.js'],
	['@vscode/markdown-it-katex', 'vendor/markdown-it-katex.js'],
	['yaml', 'vendor/yaml.js'],
	['dompurify', 'vendor/purify.js'],
	['mermaid', 'vendor/mermaid.js'],
]);

/**
 * The one module of ours that is also vendored, keyed by the module a relative specifier
 * resolves to rather than by how it is spelled: `./highlight` names it only from the root.
 */
const VENDORED_MODULES = new Map([
	['highlight', 'vendor/highlight.js'],
]);

/** Matches the specifier of a static import/export, a side-effect `import 'x'`, or a dynamic `import()`. */
const SPECIFIER_PATTERN = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/**
 * Emitted by `tsc` but replaced by a vendored build, so the emitted copy is dead code.
 *
 * `tsconfig.esm.json` excludes `highlight.ts`, which only keeps it out of the *root* file
 * list — `lazy.ts` imports it, so tsc compiles and emits it anyway, complete with 56 bare
 * imports of highlight.js internals that no browser can resolve. Deleting it here is what
 * makes the rewrite pass's unresolved-specifier check meaningful rather than noisy.
 */
const VENDORED_INSTEAD = ['highlight.js'];

async function emitOurCode() {
	// Reached by path, not `require.resolve`: TypeScript 7 does not export `./bin/tsc`.
	// tsc exits non-zero on a type error, which should stop the build.
	execFileSync(process.execPath, [
		path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
		'-p', path.join(root, 'tsconfig.esm.json'),
	], { stdio: 'inherit' });

	for (const name of VENDORED_INSTEAD) {
		await fs.rm(path.join(out, name), { force: true });
		await fs.rm(path.join(out, `${name}.map`), { force: true });
	}
}

async function buildVendor() {
	await fs.mkdir(path.join(out, 'vendor'), { recursive: true });
	for (const entry of VENDOR) {
		// Bare specifiers go through `stdin` so *esbuild* resolves them, under the browser
		// condition. Resolving them here instead would use Node's, which picks the `node`
		// export of any package that has one — yaml's, for instance, reaches for `process`
		// and `buffer` and cannot be built for a browser at all.
		const input = entry.path
			? { entryPoints: [entry.path] }
			: {
				stdin: {
					contents: `export * from ${JSON.stringify(entry.specifier)};\n`
						+ `export { default } from ${JSON.stringify(entry.specifier)};\n`,
					resolveDir: root,
					loader: 'js',
				},
			};

		await esbuild.build({
			...input,
			outfile: path.join(out, 'vendor', entry.file),
			bundle: true,
			format: 'esm',
			platform: 'browser',
			target: 'chrome105',
			logLevel: 'error',
			define: { 'process.env.NODE_ENV': '"production"' },
			// Vendored libraries are minified; our own code is not. The readability that
			// unbundling buys is readability of *our* modules — nobody debugs into a minified
			// mermaid either way, and unminified it is 7.3MB against an Android asset budget
			// of about 4.5MB for everything.
			minify: true,
		});
	}
}

/**
 * Every module of ours in the output, at any depth: the files copied verbatim from VS Code
 * keep upstream's folder layout. `vendor/` is the libraries, not our code.
 */
async function ourModules(dir = out) {
	const found = [];
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (full !== path.join(out, 'vendor')) {
				found.push(...await ourModules(full));
			}
		} else if (entry.name.endsWith('.js')) {
			found.push(full);
		}
	}
	return found;
}

/** `target`, a path from the output root, as a specifier written in a file in `dir`. */
function specifierFrom(dir, target) {
	const relative = path.relative(dir, path.join(out, target)).split(path.sep).join('/');
	return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Rewrites every specifier in the emitted JS. Two jobs: `tsc` emits `./engine` where a browser
 * needs `./engine.js`, and bare specifiers have to become vendored paths.
 */
async function rewriteSpecifiers() {
	const unknown = new Set();

	for (const file of await ourModules()) {
		const dir = path.dirname(file);
		const source = await fs.readFile(file, 'utf8');

		const rewritten = source.replace(SPECIFIER_PATTERN, (match, lead, quote, specifier) => {
			const vendored = SPECIFIERS.get(specifier);
			if (vendored) {
				return `${lead}${quote}${specifierFrom(dir, vendored)}${quote}`;
			}
			if (specifier.startsWith('.')) {
				const module = path.relative(out, path.resolve(dir, specifier)).split(path.sep).join('/');
				const vendoredModule = VENDORED_MODULES.get(module);
				if (vendoredModule) {
					return `${lead}${quote}${specifierFrom(dir, vendoredModule)}${quote}`;
				}
				// Our own module. `tsc` never adds the extension; browsers require it.
				return specifier.endsWith('.js')
					? match
					: `${lead}${quote}${specifier}.js${quote}`;
			}
			unknown.add(specifier);
			return match;
		});

		await fs.writeFile(file, rewritten);
	}

	if (unknown.size) {
		throw new Error(
			`No vendored file for: ${[...unknown].join(', ')}.\n`
			+ 'Add it to VENDOR and SPECIFIERS in scripts/build-esm.mjs — a bare specifier that '
			+ 'reaches a browser is an unresolvable import at runtime.');
	}
}

/**
 * Marks the output as ES modules for Node's benefit.
 *
 * The repo is `"type": "commonjs"`, so Node reads a `.js` file under it as CommonJS and
 * refuses the `import` statements — which makes the output unloadable by any tooling that
 * wants to exercise it, `test/verify-unbundled.mjs` included. A browser neither fetches nor
 * cares about this file; it costs 25 bytes and buys a testable artifact.
 */
async function markAsModules() {
	await fs.writeFile(path.join(out, 'package.json'), '{\n\t"type": "module"\n}\n');
}

async function copyStylesheets() {
	const cssOut = path.join(out, 'css');
	await fs.mkdir(cssOut, { recursive: true });
	for (const file of ['markdown.css', 'highlight.css', 'theme.css', 'document-overrides.css']) {
		await fs.copyFile(path.join(root, 'src/renderer/css', file), path.join(cssOut, file));
	}
	// KaTeX's stylesheet inlines its fonts, so it is built rather than copied.
	await esbuild.build({
		entryPoints: [require.resolve('katex/dist/katex.min.css')],
		outfile: path.join(cssOut, 'katex.css'),
		bundle: true,
		loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
		logLevel: 'error',
	});
}

async function copyStubHost() {
	await fs.copyFile(path.join(root, 'test/stub-host.html'), path.join(out, 'stub.html'));
	await fs.copyFile(path.join(root, 'test/stub-host.js'), path.join(out, 'stub.js'));
	await fs.cp(path.join(root, 'samples'), path.join(out, 'samples'), { recursive: true });
}

async function report() {
	const ourCode = await ourModules();
	let ourBytes = 0;
	for (const file of ourCode) {
		ourBytes += (await fs.stat(file)).size;
	}
	console.log(`  our code   ${ourCode.length} modules, ${(ourBytes / 1024).toFixed(0)}kb`);
	for (const { file } of VENDOR) {
		const { size } = await fs.stat(path.join(out, 'vendor', file));
		console.log(`  vendor/${file.padEnd(22)} ${(size / 1024).toFixed(0)}kb`);
	}
}

await fs.rm(out, { recursive: true, force: true });
await emitOurCode();
await buildVendor();
await rewriteSpecifiers();
await markAsModules();
await copyStylesheets();
await copyStubHost();
await report();
console.log('unbundled build complete');
