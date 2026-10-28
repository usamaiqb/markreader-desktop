// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The open tabs, kept across launches in `session.json` beside `settings.json`.
 *
 *  Stored and handed back the way settings are — see `settings.rs` — and for the same reason:
 *  injected before any page script runs, so the restored tabs are on the first paint instead
 *  of an empty window that fills in a round-trip later. The renderer owns the shape
 *  (`TabsModel.serialize()` in `src/renderer/tabs/model.ts`) and validates it on the way in.
 *
 *  This side knows exactly one thing about it: that it has `tabs`, each with a `path`. That
 *  is the one question the renderer cannot answer for itself without an error dialog per
 *  missing file — whether those files still exist — so it is answered here, as `missing`.
 *--------------------------------------------------------------------------------------------*/

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::settings::{escape_line_separators, read_json_at, write_to};
use crate::AppState;

const FILE_NAME: &str = "session.json";

/// Beside `settings.json`; a `--smoke` run is redirected to its scratch copy, as settings are.
fn file(app: &AppHandle) -> Option<PathBuf> {
	if let Some(state) = app.try_state::<AppState>() {
		if let Some(smoke) = state.smoke.as_ref() {
			return smoke.session_path();
		}
	}
	app.path()
		.app_config_dir()
		.ok()
		.map(|dir| dir.join(FILE_NAME))
}

/// `{ "data": <stored session or null>, "missing": [<paths that are no longer files>] }`.
fn payload(stored: &str) -> serde_json::Value {
	let data: serde_json::Value = serde_json::from_str(stored).unwrap_or(serde_json::Value::Null);
	let missing: Vec<&str> = data
		.get("tabs")
		.and_then(serde_json::Value::as_array)
		.into_iter()
		.flatten()
		.filter_map(|tab| tab.get("path").and_then(serde_json::Value::as_str))
		.filter(|path| !Path::new(path).is_file())
		.collect();
	serde_json::json!({ "data": data, "missing": missing })
}

/// Runs in the webview before any page script, as `settings::init_script` does.
pub fn init_script(app: &AppHandle) -> String {
	let json = escape_line_separators(&payload(&read_json_at(file(app))).to_string());
	format!("window.__MARKREADER_SESSION__ = {json};")
}

/// Best-effort, like settings: losing the session costs the reader their tabs, never an error
/// dialog over the document.
pub fn write(app: &AppHandle, session: &serde_json::Value) {
	if let Some(path) = file(app) {
		write_to(&path, session);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn nothing_stored_restores_nothing() {
		let value = payload("null");
		assert!(value["data"].is_null());
		assert_eq!(value["missing"], serde_json::json!([]));
	}

	#[test]
	fn reports_the_tabs_whose_files_have_gone() {
		let dir = std::env::temp_dir().join("markreader-session-missing");
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let kept = dir.join("kept.md");
		std::fs::write(&kept, "# kept").unwrap();
		let gone = dir.join("gone.md");

		let stored = serde_json::json!({
			"version": 1,
			"active": 0,
			"tabs": [
				{ "path": kept.to_string_lossy() },
				{ "path": gone.to_string_lossy() },
				// Not a file on disk at all: the About tab, say, or anything hand-edited in.
				{ "path": "About MarkReader" },
				{ "path": 7 },
				"not a tab",
			],
		});
		let value = payload(&stored.to_string());
		assert_eq!(value["data"], stored, "the session itself is handed back untouched");
		assert_eq!(
			value["missing"],
			serde_json::json!([gone.to_string_lossy(), "About MarkReader"])
		);
	}

	#[test]
	fn a_session_without_tabs_is_handed_back_as_is() {
		let value = payload(r#"{"version":1}"#);
		assert_eq!(value["data"], serde_json::json!({ "version": 1 }));
		assert_eq!(value["missing"], serde_json::json!([]));
	}
}
