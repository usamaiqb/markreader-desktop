// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Screenshot scenes.
 *
 *  Evaluated INSIDE the webview through the smoke hook, like `test/smoke-assertions.js`. Each
 *  scene puts the UI into a known state, then appends `shot <name>` to a signal file; the
 *  driver (`capture.mjs`) watches that file and captures the window while the scene holds.
 *
 *  Run with:  npm run screenshots
 *--------------------------------------------------------------------------------------------*/

(async () => {
	const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
	const smoke = window.__SMOKE__;
	// The driver creates it beside the smoke settings file; smoke_append only appends.
	const signal = smoke.settings.replace(/settings\.json$/, 'signal.txt');

	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
	const say = line => invoke('smoke_append', { path: signal, text: `${line}\n` });

	async function waitFor(description, fn, timeoutMs = 45000) {
		const started = Date.now();
		while (!fn()) {
			if (Date.now() - started > timeoutMs) {
				throw new Error(`Timed out waiting for: ${description}`);
			}
			await sleep(120);
		}
	}

	const mermaidSettled = () =>
		document.querySelectorAll('.mermaid-block').length ===
		document.querySelectorAll('.mermaid-block.rendered, .mermaid-block.failed').length;

	async function setTheme(theme) {
		// The button toggles against whatever is showing, and the default follows the OS.
		if (!document.body.classList.contains(`vscode-${theme}`)) {
			document.getElementById('btn-theme').click();
		}
		await waitFor(`${theme} theme`, () => document.body.classList.contains(`vscode-${theme}`));
		await sleep(400);
		await waitFor('mermaid redraw', mermaidSettled);
	}

	function setPane(bodyClass, button, on) {
		if (document.body.classList.contains(bodyClass) !== on) {
			document.getElementById(button).click();
		}
	}

	async function scrollTo(headingId) {
		const entry = Array.from(document.querySelectorAll('#toc-list .toc-entry'))
			.find(e => e.dataset.slug === headingId);
		if (entry) {
			entry.click();
		} else {
			document.getElementById(headingId)?.scrollIntoView();
		}
		await sleep(800);
	}

	async function shot(name) {
		await sleep(600);
		await say(`shot ${name}`);
		// The driver captures inside this window; the PowerShell start-up dominates.
		await sleep(5000);
	}

	const failures = [];
	try {
		await waitFor('document rendered', () => document.querySelector('#markdown-body h1'));
		await waitFor('mermaid', mermaidSettled);

		// Let the driver size the window before anything is captured.
		await say('resize');
		await sleep(2500);

		await invoke('open_folder', { root: smoke.root });
		await waitFor('sidebar', () => document.querySelectorAll('#file-list .file-entry').length > 0);

		// 1. The whole app: file sidebar, document, outline.
		setPane('has-sidebar', 'btn-toggle-sidebar', true);
		setPane('has-outline', 'btn-toggle-outline', true);
		window.scrollTo(0, 0);
		for (const theme of ['light', 'dark']) {
			await setTheme(theme);
			window.scrollTo(0, 0);
			await shot(`01-main-${theme}`);
		}

		// 2. Rendering: a diagram, math and highlighted code in one view, the outline tracking it.
		setPane('has-sidebar', 'btn-toggle-sidebar', false);
		for (const theme of ['light', 'dark']) {
			await setTheme(theme);
			await scrollTo('frame-pipeline');
			await shot(`02-rendering-${theme}`);
		}
	} catch (error) {
		failures.push(String(error));
	}

	await invoke('smoke_report', { report: { lines: [], failures } });
})();
