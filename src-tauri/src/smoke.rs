// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Smoke-test hook.
 *
 *    markreader --smoke test/smoke-assertions.js samples/kitchen-sink.md
 *
 *  The script is evaluated in the webview once the document is open; it runs its assertions
 *  against the live DOM and hands the results back through the `smoke_report` command, which
 *  prints them and exits with the failure count. `test/smoke.mjs` is the driver that launches
 *  the app with this flag.
 *--------------------------------------------------------------------------------------------*/

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{AppState, WINDOW_LABEL};

/// Generous: mermaid alone can take 45s on a cold webview.
const TIMEOUT: Duration = Duration::from_secs(240);

pub struct Smoke {
	script: PathBuf,
	report_path: Option<PathBuf>,
	started: AtomicBool,
}

impl Smoke {
	pub fn new(script: PathBuf, report_path: Option<PathBuf>) -> Self {
		Self {
			script,
			report_path,
			started: AtomicBool::new(false),
		}
	}

	/// Where a smoke run keeps its settings: beside the report, in the scratch directory the
	/// runner wipes before every run. That is what lets the suite exercise the real load and
	/// save path without reading — or overwriting — the developer's own settings.
	pub fn settings_path(&self) -> Option<PathBuf> {
		let report = self.report_path.as_ref()?;
		Some(report.with_file_name("settings.json"))
	}
}

/// Injected before any page script runs, so JavaScript errors from start-up are recorded too.
/// Only ever installed for a `--smoke` run.
pub fn init_script(
	file: Option<&std::path::Path>,
	root: &std::path::Path,
	settings: Option<&std::path::Path>,
) -> String {
	let file = serde_json::to_string(&file.map(|f| f.to_string_lossy().into_owned()))
		.unwrap_or_else(|_| "null".into());
	let root = serde_json::to_string(&root.to_string_lossy().into_owned())
		.unwrap_or_else(|_| "null".into());
	let settings = serde_json::to_string(&settings.map(|s| s.to_string_lossy().into_owned()))
		.unwrap_or_else(|_| "null".into());

	// Added to the window after settings.rs's own script, so reading the global here is what
	// proves the stored settings reach the page before any of its own scripts run — the bridge
	// consumes them, so by the time the assertions execute there is nothing left to look at.
	format!(
		r#"
window.__SMOKE__ = {{
	file: {file},
	root: {root},
	settings: {settings},
	settingsInjected: '__MARKREADER_SETTINGS__' in window,
	injectedSettings: window.__MARKREADER_SETTINGS__ ?? null,
	consoleErrors: [],
}};
(() => {{
	const record = message => {{ try {{ window.__SMOKE__.consoleErrors.push(String(message)); }} catch {{}} }};
	const original = console.error;
	console.error = (...args) => {{
		record(args.map(a => (a && a.stack) ? a.stack : String(a)).join(' '));
		return original.apply(console, args);
	}};
	window.addEventListener('error', event => record(event.message));
	window.addEventListener('unhandledrejection', event => record('unhandledrejection: ' + event.reason));
}})();
"#
	)
}

/// Called from `frontend_ready`, after the start-up document has been pushed.
pub fn start(app: &AppHandle) {
	let Some(state) = app.try_state::<AppState>() else {
		return;
	};
	let Some(smoke) = state.smoke.as_ref() else {
		return;
	};
	// A page reload would otherwise start a second run on top of the first.
	if smoke.started.swap(true, Ordering::SeqCst) {
		return;
	}

	let script = match std::fs::read_to_string(&smoke.script) {
		Ok(script) => script,
		Err(error) => {
			eprintln!("SMOKE TEST ERROR: cannot read {}: {error}", smoke.script.display());
			app.exit(2);
			return;
		}
	};

	let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
		eprintln!("SMOKE TEST ERROR: no window");
		app.exit(2);
		return;
	};

	if let Err(error) = window.eval(&script) {
		eprintln!("SMOKE TEST ERROR: {error}");
		app.exit(2);
		return;
	}

	// If the script never reports — a hang or a thrown exception — fail rather than sit there.
	let handle = app.clone();
	std::thread::spawn(move || {
		std::thread::sleep(TIMEOUT);
		eprintln!("SMOKE TEST ERROR: timed out after {}s", TIMEOUT.as_secs());
		handle.exit(2);
	});
}

#[derive(Debug, Deserialize)]
pub struct Report {
	/// Everything the script wants printed, already formatted.
	pub lines: Vec<String>,
	/// Names of the checks that failed.
	pub failures: Vec<String>,
}

#[tauri::command]
pub fn smoke_report(app: AppHandle, report: Report) {
	for line in &report.lines {
		println!("{line}");
	}

	println!();
	println!("========================================");
	if report.failures.is_empty() {
		println!("ALL CHECKS PASSED");
	} else {
		println!("FAILED: {} check(s)", report.failures.len());
		for failure in &report.failures {
			println!("  - {failure}");
		}
	}
	println!("========================================");
	println!();
	let _ = std::io::stdout().flush();

	// A packaged, GUI-subsystem build may have no console to print to at all, so the report is
	// also written to disk when a path was given.
	if let Some(state) = app.try_state::<AppState>() {
		if let Some(path) = state.smoke.as_ref().and_then(|s| s.report_path.clone()) {
			let json = serde_json::json!({
				"lines": report.lines,
				"failures": report.failures,
			});
			if let Err(error) = std::fs::write(&path, serde_json::to_vec_pretty(&json).unwrap_or_default()) {
				eprintln!("could not write {}: {error}", path.display());
			}
		}
	}

	app.exit(if report.failures.is_empty() { 0 } else { 1 });
}

/// Appends to a file so the run can prove live reload works. Refuses outside a `--smoke` run:
/// nothing in the shipped app should be able to write to disk.
#[tauri::command]
pub fn smoke_append(app: AppHandle, path: String, text: String) -> Result<(), String> {
	if app
		.try_state::<AppState>()
		.map(|state| state.smoke.is_none())
		.unwrap_or(true)
	{
		return Err("not a smoke run".into());
	}

	use std::io::Write as _;
	std::fs::OpenOptions::new()
		.append(true)
		.open(&path)
		.and_then(|mut file| file.write_all(text.as_bytes()))
		.map_err(|error| error.to_string())
}
