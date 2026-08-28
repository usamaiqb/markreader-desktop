// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Persisted settings. VS Code kept the preview's configuration in the workbench settings
 *  store; a standalone reader has to keep its own.
 *
 *  The renderer still owns the *shape* of the configuration — see `src/renderer/config.ts`,
 *  which is also where a stored value is validated before it is trusted. This side only stores
 *  the JSON object it is handed and returns it on the next launch, so adding a setting needs no
 *  Rust change.
 *--------------------------------------------------------------------------------------------*/

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::AppState;

const FILE_NAME: &str = "settings.json";

/// `%APPDATA%/com.markreader.app/settings.json` and its equivalents; the same directory Tauri
/// hands the rest of the app for per-user state.
///
/// A `--smoke` run is redirected to its own scratch copy — see `Smoke::settings_path`.
fn file(app: &AppHandle) -> Option<PathBuf> {
	if let Some(state) = app.try_state::<AppState>() {
		if let Some(smoke) = state.smoke.as_ref() {
			return smoke.settings_path();
		}
	}
	app.path()
		.app_config_dir()
		.ok()
		.map(|dir| dir.join(FILE_NAME))
}

/// The stored settings as compact JSON, or `null` if there is nothing usable on disk — a first
/// run, an unreadable file, or one that has been edited into invalid JSON. The renderer reads
/// `null` as "use the defaults", so a corrupt file can never stop the app from starting.
///
/// The text is re-serialized from parsed JSON rather than passed through verbatim, which is what
/// makes it safe to embed in the script below.
fn read_json_at(path: Option<PathBuf>) -> String {
	path.and_then(|path| std::fs::read_to_string(path).ok())
		.and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
		.filter(serde_json::Value::is_object)
		.map(|value| value.to_string())
		.unwrap_or_else(|| "null".to_owned())
}

/// Runs in the webview before any page script, so the renderer can apply the stored theme on
/// its first paint. Fetching the settings with an `invoke()` instead would mean painting the
/// default theme and correcting it a round-trip later — a visible flash on every launch.
pub fn init_script(app: &AppHandle) -> String {
	let json = escape_line_separators(&read_json_at(file(app)));
	format!("window.__MARKREADER_SETTINGS__ = {json};")
}

/// U+2028 and U+2029 are legal raw inside a JSON string but are line terminators to a
/// JavaScript parser, so they are put back into their escaped JSON form — still valid JSON,
/// and now safe as a JavaScript expression.
fn escape_line_separators(json: &str) -> String {
	json.replace('\u{2028}', "\\u2028")
		.replace('\u{2029}', "\\u2029")
}

/// Writes the settings the renderer handed over. Best-effort throughout: failing to persist a
/// preference must never surface as an error dialog over the document.
pub fn write(app: &AppHandle, settings: &serde_json::Value) {
	if let Some(path) = file(app) {
		write_to(&path, settings);
	}
}

fn write_to(path: &Path, settings: &serde_json::Value) {
	if let Some(parent) = path.parent() {
		if std::fs::create_dir_all(parent).is_err() {
			return;
		}
	}
	let Ok(text) = serde_json::to_string_pretty(settings) else {
		return;
	};

	// Through a sibling temp file, then renamed: this file is read at start-up, and a crash
	// part-way through a write must not leave a truncated one behind. `rename` replaces the
	// destination on every platform the app ships to.
	let temp = path.with_extension("json.tmp");
	if std::fs::write(&temp, text).is_ok() && std::fs::rename(&temp, path).is_err() {
		let _ = std::fs::remove_file(&temp);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A scratch directory under the target dir, so the tests never touch the real settings.
	fn scratch(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("markreader-settings-{name}"));
		let _ = std::fs::remove_dir_all(&dir);
		dir.join(FILE_NAME)
	}

	#[test]
	fn nothing_stored_reads_as_null() {
		assert_eq!(read_json_at(None), "null");
		assert_eq!(read_json_at(Some(scratch("absent"))), "null");
	}

	#[test]
	fn settings_round_trip() {
		let path = scratch("round-trip");
		let settings = serde_json::json!({ "theme": "dark", "fontSize": 18 });
		write_to(&path, &settings);

		let stored: serde_json::Value = serde_json::from_str(&read_json_at(Some(path))).unwrap();
		assert_eq!(stored, settings);
	}

	#[test]
	fn a_second_write_replaces_the_first_and_leaves_no_temp_file() {
		let path = scratch("replace");
		write_to(&path, &serde_json::json!({ "theme": "dark" }));
		write_to(&path, &serde_json::json!({ "theme": "light" }));

		assert_eq!(read_json_at(Some(path.clone())), r#"{"theme":"light"}"#);
		assert!(!path.with_extension("json.tmp").exists());
	}

	#[test]
	fn a_corrupt_or_unexpected_file_reads_as_null() {
		let path = scratch("corrupt");
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();

		// Truncated by a crash mid-write, hand-edited into nonsense, or a JSON value that is
		// not a settings object. All of them have to fall back to the defaults, not fail.
		for text in ["{\"theme\": ", "not json at all", "[1, 2, 3]", "\"dark\"", ""] {
			std::fs::write(&path, text).unwrap();
			assert_eq!(read_json_at(Some(path.clone())), "null", "for input {text:?}");
		}
	}

	#[test]
	fn line_separators_are_escaped_out_of_the_injected_script() {
		// U+2028 is legal raw inside a JSON string but is a line terminator to a JavaScript
		// parser, so it must not reach the page unescaped.
		let path = scratch("separators");
		write_to(&path, &serde_json::json!({ "fontFamily": "a\u{2028}b" }));
		let stored = read_json_at(Some(path));
		assert!(stored.contains('\u{2028}'));
		assert!(!escape_line_separators(&stored).contains('\u{2028}'));
	}
}
