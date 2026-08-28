// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Smoke test runner.
 *
 *  Launches the real app with `--smoke`, which evaluates `test/smoke-assertions.js` inside the
 *  webview once the document is open. The assertions run against the live DOM, report back
 *  over IPC, and the app exits with the failure count — which this script passes on.
 *
 *  The document is a copy under `test/tmp/`, because the live-reload check appends to it.
 *
 *  Run with:  npm test
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const tmp = path.join(root, 'test', 'tmp');
const assertions = path.join(root, 'test', 'smoke-assertions.js');
const reportFile = path.join(tmp, 'smoke-report.json');
/** Where a --smoke run keeps its settings, instead of the user's config directory. */
const settingsFile = path.join(tmp, 'settings.json');

/** Fresh copy of the samples folder, so `samples/kitchen-sink.md` is never modified. */
async function prepareSample() {
	await fs.rm(tmp, { recursive: true, force: true });
	await fs.mkdir(tmp, { recursive: true });
	await fs.cp(path.join(root, 'samples'), path.join(tmp, 'samples'), { recursive: true });
	return path.join(tmp, 'samples', 'kitchen-sink.md');
}

async function main() {
	const sample = await prepareSample();

	// cargo runs from src-tauri so it picks up that crate's cargo config; the app is told
	// which folder to scan for the sidebar checks rather than inferring it from the cwd.
	const child = spawn('cargo', [
		'run',
		'--quiet',
		'--',
		'--smoke', assertions,
		'--smoke-out', reportFile,
		'--smoke-root', root,
		sample,
	], {
		cwd: path.join(root, 'src-tauri'),
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});

	const code = await new Promise(resolve => {
		child.on('error', error => {
			console.error(`could not start cargo: ${error.message}`);
			resolve(1);
		});
		child.on('exit', resolve);
	});

	// A second instance hands its arguments to the running one and exits straight away, which
	// would otherwise look like a clean pass with no output.
	const report = await fs.readFile(reportFile, 'utf8').then(JSON.parse).catch(() => undefined);
	if (!report?.lines?.length) {
		console.error('\nNo smoke report was produced. Is another MarkReader instance already running?');
		process.exit(1);
	}

	// The in-page assertions cover the load side of settings persistence; the save side lands
	// on disk, where only this process can see it. The suite switched to the light theme, so
	// that is what has to be in the file — along with the settings it never touched.
	if (code === 0) {
		const problem = await checkSavedSettings();
		if (problem) {
			console.error('');
			console.error('SETTINGS CHECK FAILED: ' + problem);
			console.error('');
			process.exit(1);
		}
		console.log('  PASS  settings saved to ' + path.relative(root, settingsFile));
		console.log('');
	}

	process.exit(code ?? 1);
}

/** What is wrong with the settings the run saved, or nothing if they are fine. */
async function checkSavedSettings() {
	const text = await fs.readFile(settingsFile, 'utf8').catch(() => undefined);
	if (text === undefined) {
		return 'nothing was written to ' + settingsFile;
	}

	let settings;
	try {
		settings = JSON.parse(text);
	} catch (error) {
		return settingsFile + ' is not valid JSON: ' + error.message;
	}

	if (settings.theme !== 'light') {
		return 'the theme switch was not persisted (theme is ' + JSON.stringify(settings.theme) + ')';
	}
	if (typeof settings.wordWrap !== 'boolean' || typeof settings.fontFamily !== 'string') {
		return 'the settings the run never changed are missing from the file';
	}
	return undefined;
}

main().catch(error => {
	console.error('\nSMOKE TEST ERROR:', error);
	process.exit(1);
});
