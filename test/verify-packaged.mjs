// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Verifies the PACKAGED app, not the dev build.
 *
 *  Runs the release binary with the same in-app smoke harness `npm test` uses, so the whole
 *  assertion set is re-run against the real artifact: bundled frontend assets, the lazily
 *  imported mermaid chunk, the `mdr://` protocol and the file watcher. A release build is a
 *  GUI-subsystem binary with no console of its own when spawned, so the report comes back
 *  through `--smoke-out` rather than stdout.
 *
 *  Run with:  npm run package:dir && npm run verify:packaged
 *--------------------------------------------------------------------------------------------*/

import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = path.join(import.meta.dirname, '..');
const tmp = path.join(root, 'test', 'tmp');
const assertions = path.join(root, 'test', 'smoke-assertions.js');
const reportFile = path.join(tmp, 'packaged-report.json');
/** A --smoke run keeps its settings beside its report, not in the user config directory. */
const settingsFile = path.join(tmp, 'settings.json');

const failures = [];
function check(name, ok, detail = '') {
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) {
		failures.push(name);
	}
}

/** cargo decides where build output lives, so ask it rather than guessing. */
async function targetDirectory() {
	const { stdout } = await execFileAsync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
		cwd: path.join(root, 'src-tauri'),
		maxBuffer: 32 * 1024 * 1024,
		shell: process.platform === 'win32',
	});
	return JSON.parse(stdout).target_directory;
}

async function sizeOf(file) {
	return fs.stat(file).then(s => s.size).catch(() => undefined);
}

function megabytes(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function main() {
	const target = await targetDirectory();
	const release = path.join(target, 'release');
	const exe = path.join(release, process.platform === 'win32' ? 'markreader.exe' : 'markreader');

	await fs.access(exe).catch(() => {
		throw new Error(`Packaged app not found at ${exe}\nRun: npm run package:dir`);
	});

	// The live-reload check appends to the document, so it works on a copy.
	await fs.rm(tmp, { recursive: true, force: true });
	await fs.mkdir(tmp, { recursive: true });
	await fs.cp(path.join(root, 'samples'), path.join(tmp, 'samples'), { recursive: true });
	const sample = path.join(tmp, 'samples', 'kitchen-sink.md');

	console.log(`\nlaunching ${path.relative(root, exe)}`);
	const child = spawn(exe, [
		'--smoke', assertions,
		'--smoke-out', reportFile,
		'--smoke-root', root,
		sample,
	], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

	const stderr = [];
	child.stderr.on('data', chunk => stderr.push(chunk.toString()));

	const code = await new Promise(resolve => {
		child.on('error', error => {
			console.error(`could not start the packaged app: ${error.message}`);
			resolve(1);
		});
		child.on('exit', resolve);
	});

	const report = await fs.readFile(reportFile, 'utf8').then(JSON.parse).catch(() => undefined);
	if (!report?.lines?.length) {
		console.error('\nThe packaged app produced no report. Is another MarkReader instance running?');
		process.exit(1);
	}

	for (const line of report.lines) {
		console.log(line);
	}

	console.log('');
	check('every assertion passes against the packaged binary',
		report.failures.length === 0, report.failures.join(', '));
	check('the packaged app exits cleanly', code === 0, `exit code ${code}`);

	// Subsystems a headless runner does not have still complain on stderr, with "error" in the
	// text: no accessibility bus (AT-SPI/dbind), no GPU (EGL/DRI3/Mesa), no sound theme
	// (canberra), no settings daemon (dconf). Windows has its own parting shot as the window
	// class goes. None of it says anything about the app.
	const environmental =
		/AT-SPI|org\.a11y\.Bus|dbind-WARNING|libEGL|DRI3|MESA-LOADER|swrast|canberra|dconf-WARNING|Chrome_WidgetWin|unregister class/i;

	const errors = stderr.join('').split('\n')
		.filter(line => /error|ERR_|failed/i.test(line))
		.filter(line => !/mermaid|Parse error|Syntax error/i.test(line))
		.filter(line => !environmental.test(line));
	check('no errors on stderr', errors.length === 0, errors.slice(0, 3).join(' | '));

	// The report covers loading settings; saving them ends up on disk, where only this process
	// can see it. The assertions switch to the light theme, so that is what has to be there.
	const settings = await fs.readFile(settingsFile, 'utf8')
		.then(JSON.parse).catch(() => undefined);
	check('settings are written from the packaged binary', settings !== undefined, settingsFile);
	check('the theme switch was persisted', settings?.theme === 'light',
		JSON.stringify(settings?.theme));

	console.log('\n--- artifact size ---');
	const exeSize = await sizeOf(exe);
	console.log(`  exe        ${megabytes(exeSize)}  ${path.relative(root, exe)}`);

	const installerDir = path.join(release, 'bundle', 'nsis');
	const installers = await fs.readdir(installerDir).catch(() => []);
	for (const name of installers.filter(n => n.endsWith('.exe'))) {
		const size = await sizeOf(path.join(installerDir, name));
		console.log(`  installer  ${megabytes(size)}  ${path.join('…', 'bundle', 'nsis', name)}`);
	}
	check('binary is under 40MB', exeSize < 40 * 1024 * 1024,
		megabytes(exeSize));

	console.log('\n========================================');
	console.log(failures.length ? `FAILED: ${failures.length}` : 'PACKAGED APP VERIFIED');
	console.log('========================================\n');
	process.exit(failures.length ? 1 : 0);
}

main().catch(error => {
	console.error('\nERROR:', error.message);
	process.exit(1);
});
