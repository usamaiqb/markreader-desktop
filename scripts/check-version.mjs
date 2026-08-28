// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Version consistency check.
 *
 *  The version lives in five places (npm, the Rust crate and its lockfile, and the Tauri bundle
 *  config), and Tauri has no single source of truth. This script reads them all and fails if
 *  they disagree, so a release can't ship with mismatched versions.
 *
 *    npm run check:version            fail if any file disagrees with package.json
 *    npm run check:version -- --fix   write the version from package.json into the others
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const fix = process.argv.includes('--fix');

/** Where the canonical version lives, and the files that must agree with it. */
const packageJsonPath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const expected = packageJson.version;

const sources = [
	{
		name: 'package.json',
		read: () => JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version,
		write: v => {
			const json = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
			json.version = v;
			fs.writeFileSync(packageJsonPath, JSON.stringify(json, null, '\t') + '\n');
		},
	},
	{
		name: 'package-lock.json (root)',
		read: () => JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).version,
		write: v => {
			const json = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
			json.version = v;
			fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(json, null, '  ') + '\n');
		},
	},
	{
		name: 'package-lock.json (packages[""])',
		read: () => JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages[''].version,
		write: v => {
			const json = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
			json.packages[''].version = v;
			fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(json, null, '  ') + '\n');
		},
	},
	{
		name: 'src-tauri/Cargo.toml',
		read: () => /^version = "([^"]+)"$/m.exec(fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8'))?.[1],
		write: v => {
			const file = path.join(root, 'src-tauri', 'Cargo.toml');
			fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^version = "[^"]*"$/m, `version = "${v}"`));
		},
	},
	{
		name: 'src-tauri/Cargo.lock',
		read: () => /name = "markreader"\nversion = "([^"]+)"/.exec(fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), 'utf8'))?.[1],
		write: () => {
			throw new Error('Cargo.lock is generated; run `cargo build` (or `cargo update -p markreader`) after bumping Cargo.toml.');
		},
	},
	{
		name: 'src-tauri/tauri.conf.json',
		read: () => JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version,
		write: v => {
			const file = path.join(root, 'src-tauri', 'tauri.conf.json');
			fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/"version": "[^"]*"/, `"version": "${v}"`));
		},
	},
];

const mismatches = [];
for (const source of sources) {
	const actual = source.read();
	if (actual === undefined) {
		console.error(`  ??  ${source.name}: could not read a version`);
		mismatches.push(source.name);
	} else if (actual !== expected) {
		console.log(`  !!  ${source.name}: ${actual}`);
		mismatches.push(source.name);
	} else {
		console.log(`  OK  ${source.name}: ${actual}`);
	}
}

if (mismatches.length === 0) {
	console.log(`\nAll versions match ${expected}.`);
	process.exit(0);
}

console.log(`\nMismatch: expected ${expected} everywhere.`);
if (!fix) {
	console.log(`Run: npm run check:version -- --fix  (Cargo.lock requires a cargo build afterwards)`);
	process.exit(1);
}

console.log('\nFixing…');
for (const source of sources) {
	if (!mismatches.includes(source.name)) {
		continue;
	}
	try {
		source.write(expected);
		console.log(`  fixed ${source.name}`);
	} catch (error) {
		console.error(`  !!  ${source.name}: ${error.message}`);
		process.exitCode = 1;
	}
}

if (process.exitCode) {
	process.exit(process.exitCode);
}

console.log('\nAll files written. If Cargo.toml changed, run `cargo build` to regenerate Cargo.lock.');
