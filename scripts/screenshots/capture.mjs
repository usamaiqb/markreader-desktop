// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Screenshot driver (Windows).
 *
 *  Copies the demo folder (`metadata/demo/`) to a short path, launches the app on it with the
 *  smoke hook running `scenes.js`, and captures the window each time a scene signals it is
 *  ready. The PNGs land in `metadata/screenshots/`, which the README and the AppStream
 *  metainfo both point at.
 *
 *    npm run screenshots                    demo copied to C:\Docs\lumen
 *    npm run screenshots -- D:\some\folder  or wherever you like
 *
 *  The folder path shows in the app's title bar, so keep it short and impersonal.
 *--------------------------------------------------------------------------------------------*/

import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

if (process.platform !== 'win32') {
	console.error('The screenshot driver only runs on Windows.');
	process.exit(1);
}

const root = path.join(import.meta.dirname, '..', '..');
const demo = path.resolve(process.argv[2] ?? String.raw`C:\Docs\lumen`);
const outDir = path.join(root, 'metadata', 'screenshots');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'markreader-shots-'));
const signal = path.join(scratch, 'signal.txt');

fs.rmSync(demo, { recursive: true, force: true });
fs.cpSync(path.join(root, 'metadata', 'demo'), demo, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(signal, '');

function windowCommand(...args) {
	const out = execFileSync('powershell.exe', [
		'-NoProfile', '-ExecutionPolicy', 'Bypass',
		'-File', path.join(import.meta.dirname, 'window.ps1'),
		...args,
	], { encoding: 'utf8' });
	if (out.trim()) {
		console.log(out.trim());
	}
}

let handled = 0;
const watcher = setInterval(() => {
	const lines = fs.readFileSync(signal, 'utf8').split('\n').filter(Boolean);
	for (const line of lines.slice(handled)) {
		handled++;
		const [action, name] = line.split(' ');
		if (action === 'resize') {
			windowCommand('-Action', 'resize');
		} else if (action === 'shot') {
			windowCommand('-Action', 'shot', '-Out', path.join(outDir, `${name}.png`));
		}
	}
}, 200);

const child = spawn('cargo', [
	'run', '--quiet', '--',
	'--smoke', path.join(import.meta.dirname, 'scenes.js'),
	'--smoke-out', path.join(scratch, 'report.json'),
	'--smoke-root', demo,
	path.join(demo, 'design.md'),
], {
	cwd: path.join(root, 'src-tauri'),
	stdio: 'inherit',
	// Render the page at 2x whatever the display scale is, so the shots stay sharp when GitHub
	// or a software centre scales them down. The window is sized in physical pixels to match.
	env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--force-device-scale-factor=2' },
});

const code = await new Promise(resolve => child.on('exit', resolve));
clearInterval(watcher);
fs.rmSync(scratch, { recursive: true, force: true });
fs.rmSync(demo, { recursive: true, force: true });
process.exit(code ?? 1);
