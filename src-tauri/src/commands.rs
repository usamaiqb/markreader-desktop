// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The commands the bridge calls. One per method on `window.markreader`, which
 *  `src/bridge/bridge.ts` maps onto these.
 *--------------------------------------------------------------------------------------------*/

use std::path::Path;
use std::sync::atomic::Ordering;

use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::document::{self, MarkDocument};
use crate::{AppState, WINDOW_LABEL};

/// The extensions the open dialog offers.
const MARKDOWN_EXTENSIONS: &[&str] = &[
	"md", "markdown", "mdown", "mkdn", "mkd", "mdwn", "mdtxt", "mdtext", "workbook",
];

/// Page-originated commands answer the window that called them, so the label is taken from
/// the caller rather than assumed — the same code then serves a second window unchanged.
#[tauri::command]
pub fn open_file_dialog(app: AppHandle, window: WebviewWindow) {
	pick_file(&app, window.label());
}

#[tauri::command]
pub fn open_folder_dialog(app: AppHandle, window: WebviewWindow) {
	pick_folder(&app, window.label());
}

/// The open dialog, for the window `label`. Shared by the command and the menu.
pub fn pick_file(app: &AppHandle, label: &str) {
	let handle = app.clone();
	let label = label.to_owned();
	// Callback form, not `blocking_pick_file`: a modal that blocks the main thread would
	// deadlock the event loop this command is dispatched from.
	app.dialog()
		.file()
		.set_title("Open Markdown file")
		.add_filter("Markdown", MARKDOWN_EXTENSIONS)
		.add_filter("All Files", &["*"])
		.pick_file(move |selection| {
			if let Some(path) = selection.and_then(|p| p.into_path().ok()) {
				document::open(&handle, &label, &path);
			}
		});
}

/// The folder dialog, for the window `label`.
pub fn pick_folder(app: &AppHandle, label: &str) {
	let handle = app.clone();
	let label = label.to_owned();
	app.dialog()
		.file()
		.set_title("Open folder")
		.pick_folder(move |selection| {
			if let Some(root) = selection.and_then(|p| p.into_path().ok()) {
				document::open_folder(&handle, &label, &root);
			}
		});
}

#[tauri::command]
pub fn open_document(app: AppHandle, window: WebviewWindow, path: String) {
	document::open(&app, window.label(), Path::new(&path));
}

/// The folder equivalent, used by the CLI and the smoke run to skip the dialog.
#[tauri::command]
pub fn open_folder(app: AppHandle, window: WebviewWindow, root: String) {
	document::open_folder(&app, window.label(), Path::new(&root));
}

/// The renderer's open set for its window, sent whenever it changes. Synchronous on purpose:
/// the renderer awaits it before rendering the active document, and the roots must be in place
/// by then for that document's images to load on first paint. See `document::sync`.
#[tauri::command]
pub fn sync_documents(window: WebviewWindow, open: Vec<String>, active: Option<String>) {
	document::sync(window.app_handle(), window.label(), &open, active.as_deref());
}

#[tauri::command]
pub fn read_document(app: AppHandle, path: String) -> Option<MarkDocument> {
	document::read_or_report(&app, &document::resolve(Path::new(&path)))
}

/// A document the renderer opened itself — from the file list or a link — rather than through
/// `open_document`, which notes it on the way. Ignored unless it is a file on disk.
#[tauri::command]
pub fn note_recent_document(app: AppHandle, path: String) {
	let path = document::resolve(Path::new(&path));
	if path.is_absolute() && path.is_file() {
		document::note_recent(&app, &path);
	}
}

/// The only schemes a document may ask the OS to open.
///
/// This is the last line rather than the first — the renderer checks the scheme before it
/// calls, and the sanitizer strips `javascript:` before that. It is here because a link in an
/// untrusted document should not decide what the platform launches, and this is the one place
/// that decision cannot be routed around.
fn is_openable_external(url: &str) -> bool {
	let lowered = url.to_lowercase();
	lowered.starts_with("http://") || lowered.starts_with("https://") || lowered.starts_with("mailto:")
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) {
	if is_openable_external(&url) {
		let _ = app.opener().open_url(url, None::<&str>);
	}
}

#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) {
	let _ = app
		.opener()
		.reveal_item_in_dir(document::resolve(Path::new(&path)));
}

/// The renderer owns the theme decision; the window chrome follows it.
#[tauri::command]
pub fn set_window_background(app: AppHandle, color: String) {
	let Some(color) = parse_hex_color(&color) else {
		return;
	};
	if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
		let _ = window.set_background_color(Some(color));
	}
}

/// Persists the renderer's configuration. The renderer decides what the object contains and
/// validates it again on the way back in; this only stores it.
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: serde_json::Value) {
	crate::settings::write(&app, &settings);
}

/// Called once the bridge and the renderer have both registered their event listeners. Until
/// then there is nobody to receive `document:opened`, so a file from the command line has to
/// wait here rather than race the listeners.
#[tauri::command]
pub fn frontend_ready(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>) {
	show_window(&app);

	let startup = state.startup_file.lock().ok().and_then(|mut f| f.take());
	if let Some(path) = startup {
		document::open(&app, window.label(), &path);
	}

	crate::smoke::start(&app);
}

/// Shows the window the first time it is asked. The window starts hidden so the empty white
/// frame never appears on screen during start-up.
pub fn show_window(app: &AppHandle) {
	if let Some(state) = app.try_state::<AppState>() {
		if state.window_shown.swap(true, Ordering::SeqCst) {
			return;
		}
	}
	if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
		let _ = window.show();
		let _ = window.set_focus();
	}
}

/// `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, matching the shapes the old
/// `window:setBackground` regex accepted.
fn parse_hex_color(value: &str) -> Option<Color> {
	let hex = value.strip_prefix('#')?;
	if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
		return None;
	}

	let expand = |c: u8| -> u8 {
		let digit = (c as char).to_digit(16).unwrap_or(0) as u8;
		digit * 17
	};

	let bytes = hex.as_bytes();
	let pair = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0);

	match hex.len() {
		3 => Some(Color(expand(bytes[0]), expand(bytes[1]), expand(bytes[2]), 255)),
		4 => Some(Color(
			expand(bytes[0]),
			expand(bytes[1]),
			expand(bytes[2]),
			expand(bytes[3]),
		)),
		6 => Some(Color(pair(0), pair(2), pair(4), 255)),
		8 => Some(Color(pair(0), pair(2), pair(4), pair(6))),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn opens_the_three_allowed_schemes() {
		assert!(is_openable_external("https://example.com/x"));
		assert!(is_openable_external("http://example.com/x"));
		assert!(is_openable_external("mailto:someone@example.com"));
	}

	#[test]
	fn ignores_the_case_a_document_wrote_the_scheme_in() {
		assert!(is_openable_external("HTTPS://example.com"));
		assert!(is_openable_external("MailTo:someone@example.com"));
	}

	#[test]
	fn refuses_everything_else() {
		for url in [
			"javascript:alert(1)",
			"vbscript:msgbox(1)",
			"file:///etc/passwd",
			"data:text/html,<script>alert(1)</script>",
			"ms-msdt:/id",
			"smb://host/share",
			"mdr://localhost/C:/secret.txt",
			"",
		] {
			assert!(!is_openable_external(url), "{url} should not be openable");
		}
	}

	#[test]
	fn refuses_a_scheme_that_merely_contains_an_allowed_one() {
		// A prefix check, not a substring one.
		assert!(!is_openable_external("javascript:https://example.com"));
		assert!(!is_openable_external(" https://example.com"));
	}
}
