#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate
/*---------------------------------------------------------------------------------------------
 *  Cross-platform command-line launcher.
 *
 *  npm's `bin` field generates the platform shim for this file (a .cmd on Windows, a shell
 *  script elsewhere), so `markreader file.md` works from any terminal after `npm link` or a
 *  global install. This replaces the old platform-specific markreader.cmd / markreader shell
 *  scripts with one file that runs everywhere.
 *
 *  It picks the installed app if there is one, otherwise a release or debug build (cargo
 *  decides where the target dir lives, so we ask it rather than guessing).
 *--------------------------------------------------------------------------------------------*/

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const binaryName = process.platform === 'win32' ? 'markreader.exe' : 'markreader';

function exists(file) {
	try {
		return fs.existsSync(file);
	} catch {
		return false;
	}
}

/** Where each platform installs the app, in the order we prefer them. */
function installedApps() {
	if (process.platform === 'win32') {
		return [path.join(process.env.LOCALAPPDATA ?? '', 'MarkReader', 'MarkReader.exe')];
	}
	if (process.platform === 'darwin') {
		return ['/Applications/MarkReader.app/Contents/MacOS/markreader'];
	}
	return ['/usr/local/bin/markreader', '/usr/bin/markreader'];
}

/** The crate's actual output directory — honors a local .cargo/config.toml override. */
function cargoTargetDir() {
	try {
		const out = execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
			cwd: path.join(root, 'src-tauri'),
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return JSON.parse(out.toString()).target_directory;
	} catch {
		return undefined;
	}
}

function findExecutable() {
	for (const app of installedApps()) {
		if (exists(app)) {
			return app;
		}
	}

	const candidates = [];
	const target = cargoTargetDir();
	if (target) {
		candidates.push(path.join(target, 'release', binaryName), path.join(target, 'debug', binaryName));
	} else {
		candidates.push(
			path.join(root, 'src-tauri', 'target', 'release', binaryName),
			path.join(root, 'src-tauri', 'target', 'debug', binaryName),
		);
	}
	return candidates.find(exists);
}

let args = process.argv.slice(2);

// -w / --wait keeps the process in the foreground so stdout and stderr are visible.
let wait = false;
if (args[0] === '-w' || args[0] === '--wait') {
	wait = true;
	args = args.slice(1);
}

// Expand a relative path against the CURRENT directory so `markreader notes.md` works anywhere.
if (args.length && !path.isAbsolute(args[0])) {
	args[0] = path.resolve(args[0]);
}

const exe = findExecutable();
if (!exe) {
	console.error('MarkReader: no build found. Run "npm run package:dir" for a portable executable.');
	process.exit(1);
}

const child = spawn(exe, args, {
	stdio: wait ? 'inherit' : 'ignore',
	detached: !wait,
});

// Without -w, let the app outlive this shim and return to the prompt immediately.
if (!wait) {
	child.unref();
} else {
	child.on('exit', code => process.exit(code ?? 1));
}
