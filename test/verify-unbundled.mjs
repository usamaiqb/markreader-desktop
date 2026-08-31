// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Verifies the unbundled build (`npm run build:esm`).
 *
 *  A bundler resolves imports at build time and a browser resolves them at load time, which is
 *  why "works bundled, breaks unbundled" is a class of bug rather than a bug: every specifier
 *  the bundler quietly fixed up becomes a 404 that only shows on a device. This walks every
 *  import in the output and insists it names a file that exists.
 *
 *  It is a static check. It proves the module graph is loadable, not that the renderer draws
 *  the right thing — that is what `stub.html` is for, opened in a browser.
 *
 *  Run with:  npm run verify:esm
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const out = path.join(root, 'out', 'renderer-esm');

let failures = 0;

function check(name, ok, detail = '') {
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) {
		failures++;
	}
}

const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g;

function specifiersIn(source) {
	return [...source.matchAll(SPECIFIER_PATTERN)].map(match => match[2]);
}

async function exists(file) {
	return fs.access(file).then(() => true, () => false);
}

async function jsFilesUnder(dir) {
	const found = [];
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...await jsFilesUnder(full));
		} else if (entry.name.endsWith('.js')) {
			found.push(full);
		}
	}
	return found;
}

async function main() {
	if (!await exists(out)) {
		console.error(`\nNo unbundled build at ${path.relative(root, out)}. Run: npm run build:esm\n`);
		process.exit(1);
	}

	console.log('--- module graph ---');

	// Our modules only. The vendored bundles are minified and self-contained, and scanning
	// them for import syntax finds `x.from,` and template-literal fragments instead — they get
	// the self-containment checks below rather than this one. The rewrite pass only ever
	// touches our code anyway, so this is where its output has to be right.
	const files = (await fs.readdir(out))
		.filter(name => name.endsWith('.js'))
		.map(name => path.join(out, name));
	const unresolved = [];
	const bare = [];

	for (const file of files) {
		const source = await fs.readFile(file, 'utf8');
		for (const specifier of specifiersIn(source)) {
			if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
				bare.push(`${path.relative(out, file)} -> ${specifier}`);
				continue;
			}
			const target = path.resolve(path.dirname(file), specifier);
			if (!await exists(target)) {
				unresolved.push(`${path.relative(out, file)} -> ${specifier}`);
			}
		}
	}

	check(`every import resolves to a file (${files.length} of our modules)`,
		unresolved.length === 0, unresolved.join('; '));
	check('no bare specifiers survive the rewrite pass',
		bare.length === 0, bare.join('; '));
	check('the document module is emitted unbundled, not inlined',
		files.some(f => path.basename(f) === 'document.js')
		&& files.some(f => path.basename(f) === 'engine.js'));

	console.log('');
	console.log('--- vendored libraries ---');

	// The trap this build hit once: esbuild converting CommonJS with a dependency marked
	// external emits a `__require` shim whose body throws. It builds clean and fails at the
	// first document that needs it.
	const vendor = await jsFilesUnder(path.join(out, 'vendor'));
	const throwing = [];
	for (const file of vendor) {
		if ((await fs.readFile(file, 'utf8')).includes('Dynamic require of')) {
			throwing.push(path.basename(file));
		}
	}
	check(`no throwing require shims (${vendor.length} libraries)`,
		throwing.length === 0, throwing.join(', '));

	for (const name of ['markdown-it.js', 'markdown-it-katex.js', 'yaml.js', 'purify.js',
		'mermaid.js', 'highlight.js']) {
		const file = path.join(out, 'vendor', name);
		const size = await fs.stat(file).then(s => s.size, () => 0);
		check(`vendor/${name} built`, size > 1024, `${size} bytes`);
	}

	console.log('');
	console.log('--- the stub host ---');

	const stub = await fs.readFile(path.join(out, 'stub.html'), 'utf8');
	const referenced = [...stub.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
		.concat(specifiersIn(stub))
		.filter(ref => ref.startsWith('./') || ref.startsWith('css/'));

	const missing = [];
	for (const ref of referenced) {
		if (!await exists(path.join(out, ref))) {
			missing.push(ref);
		}
	}
	check(`everything the stub loads exists (${referenced.length} references)`,
		missing.length === 0, missing.join(', '));

	// The stub is the document module's second consumer, so app.css must not be one of them.
	// Matched as a link rather than as text — the stub's own comment says why it is absent.
	check('the stub loads no desktop chrome', !/<link[^>]+app\.css/.test(stub));
	check('the stub loads no desktop shell', !/shell\.js|renderer\.js/.test(stub));
	check('a sample document is available to it', await exists(path.join(out, 'samples/kitchen-sink.md')));

	console.log('');
	await checkItRenders();

	console.log('');
	if (failures) {
		console.log(`FAILED: ${failures} check(s)`);
		process.exit(1);
	}
	console.log('UNBUNDLED BUILD VERIFIED');
}

/**
 * Loads the built modules for real and renders a document through them.
 *
 * The checks above prove the module graph resolves; this proves it *executes*. It is the
 * difference between "the imports point at files" and "markdown-it, DOMPurify, KaTeX and
 * highlight.js all load and produce output", which is where an unbundled build actually
 * breaks — a package whose browser entry point assumes a bundler, or an interop shim that
 * only throws once called.
 *
 * jsdom, not a browser: no layout, so no mermaid and nothing about how it *looks*. `stub.html`
 * remains the thing to open by eye. What this covers is that the graph is alive.
 */
async function checkItRenders() {
	console.log('--- the modules execute ---');

	const { JSDOM } = await import('jsdom');
	const dom = new JSDOM(
		'<!doctype html><html><head>'
		// Pre-seeded so the lazy KaTeX stylesheet loader takes its already-present branch:
		// jsdom fires neither load nor error for a stylesheet it never fetches.
		+ '<link rel="stylesheet" href="css/katex.css">'
		+ '</head><body class="vscode-dark wordWrap">'
		+ '<div class="markdown-body" id="markdown-body"></div></body></html>',
		{ url: 'http://localhost/', pretendToBeVisual: true });

	const { window } = dom;
	window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
	window.CSS = {};
	for (const name of ['window', 'document', 'navigator', 'CSS', 'Node', 'NodeFilter', 'Range',
		'HTMLElement', 'Element', 'getComputedStyle', 'requestAnimationFrame']) {
		// Assignment, not `globalThis.x =`: Node 24 defines `navigator` as a getter-only
		// property, so plain assignment throws.
		Object.defineProperty(globalThis, name, {
			value: window[name], writable: true, configurable: true,
		});
	}

	const { pathToFileURL } = await import('node:url');
	const { DocumentView } = await import(pathToFileURL(path.join(out, 'document.js')).href);

	const sample = path.join(out, 'samples', 'kitchen-sink.md');
	const text = await fs.readFile(sample, 'utf8');

	const view = new DocumentView({
		root: window.document.getElementById('markdown-body'),
		host: {
			capabilities: { revealInFolder: false, windowBackground: false, watchesFiles: false },
			async readFile() { return undefined; },
			async openPath() {},
			async openExternal() {},
		},
	});

	const rendered = new Promise(resolve => {
		const timer = setTimeout(() => resolve(false), 20000);
		view.on('headings', headings => {
			if (headings.length) {
				clearTimeout(timer);
				resolve(true);
			}
		});
	});

	view.setDocument({ path: '/samples/kitchen-sink.md', text }, { preserveScroll: false });
	check('a document renders through the built modules', await rendered);

	const body = window.document.getElementById('markdown-body');
	const counts = {
		headings: body.querySelectorAll('h1[id], h2[id], h3[id]').length,
		code: body.querySelectorAll('pre code').length,
		highlighted: body.querySelectorAll('pre code .hljs-keyword, pre code .hljs-string').length,
		katex: body.querySelectorAll('.katex').length,
		tables: body.querySelectorAll('.table-wrapper > table').length,
		anchors: body.querySelectorAll('.heading-anchor').length,
		mermaid: body.querySelectorAll('.mermaid-block').length,
	};

	check('markdown-it parsed the document', counts.headings >= 15, `${counts.headings} headings`);
	check('DOMPurify kept the content', counts.tables >= 1 && counts.code >= 3, JSON.stringify(counts));
	check('highlight.js loaded and highlighted', counts.highlighted > 5, `${counts.highlighted} tokens`);
	check('KaTeX loaded and rendered math', counts.katex >= 3, `${counts.katex} nodes`);
	check('the document module added its own affordances',
		counts.anchors >= 15 && counts.mermaid === 3, JSON.stringify(counts));
	check('no script survived the sanitizer', !body.innerHTML.includes('<script'));
}

main().catch(error => {
	console.error('\nVERIFY ERROR:', error);
	process.exit(1);
});
