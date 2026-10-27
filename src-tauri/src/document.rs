// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Opening, reading and watching a window's documents — path resolution, encoding detection,
 *  the per-window open set, and the events the frontend listens for.
 *--------------------------------------------------------------------------------------------*/

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct MarkDocument {
	pub path: String,
	pub text: String,
}

/// Makes a path absolute without resolving symlinks and without a verbatim prefix, so the
/// path the renderer sees stays the one the user recognizes.
pub fn resolve(path: &Path) -> PathBuf {
	std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

pub fn read(path: &Path) -> std::io::Result<MarkDocument> {
	let bytes = std::fs::read(path)?;
	Ok(MarkDocument {
		path: path.to_string_lossy().into_owned(),
		text: decode(&bytes),
	})
}

const BOM_UTF8: [u8; 3] = [0xEF, 0xBB, 0xBF];
const BOM_UTF16_LE: [u8; 2] = [0xFF, 0xFE];
const BOM_UTF16_BE: [u8; 2] = [0xFE, 0xFF];

/// Byte order of a UTF-16 document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Utf16 {
	Little,
	Big,
}

/// Decodes a document's bytes to text.
///
/// Decoding as UTF-8 unconditionally meant a UTF-16 file rendered as mojibake and a UTF-8 BOM
/// leaked into the text — where it also broke first-line heading detection, since the document
/// then started with U+FEFF rather than `#`. UTF-8 stays the fallback, still lossy rather than
/// failing, so an ordinary file decodes exactly as it always did.
pub fn decode(bytes: &[u8]) -> String {
	if let Some(rest) = bytes.strip_prefix(&BOM_UTF8) {
		return String::from_utf8_lossy(rest).into_owned();
	}
	if let Some(rest) = bytes.strip_prefix(&BOM_UTF16_LE) {
		return decode_utf16(rest, Utf16::Little);
	}
	if let Some(rest) = bytes.strip_prefix(&BOM_UTF16_BE) {
		return decode_utf16(rest, Utf16::Big);
	}
	match sniff_utf16(bytes) {
		Some(order) => decode_utf16(bytes, order),
		None => String::from_utf8_lossy(bytes).into_owned(),
	}
}

/// A trailing odd byte and unpaired surrogates are substituted rather than rejected, matching
/// how the UTF-8 path treats bad input.
fn decode_utf16(bytes: &[u8], order: Utf16) -> String {
	let units = bytes.chunks_exact(2).map(|pair| {
		let pair = [pair[0], pair[1]];
		match order {
			Utf16::Little => u16::from_le_bytes(pair),
			Utf16::Big => u16::from_be_bytes(pair),
		}
	});

	let mut text: String = char::decode_utf16(units)
		.map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
		.collect();
	if bytes.len() % 2 == 1 {
		text.push(char::REPLACEMENT_CHARACTER);
	}
	text
}

/// Guesses the byte order of a BOM-less UTF-16 document.
///
/// Well-formed UTF-8 contains no NUL bytes, while UTF-16 text in the ASCII range is half NULs —
/// and which half gives the byte order away. Only a prefix is sampled: that is enough for the
/// ASCII a Markdown document opens with, and cheap on a large file.
fn sniff_utf16(bytes: &[u8]) -> Option<Utf16> {
	const SAMPLE: usize = 512;

	let sample = &bytes[..bytes.len().min(SAMPLE)];
	if sample.len() < 2 || !sample.contains(&0) {
		return None;
	}

	let (mut even, mut odd) = (0usize, 0usize);
	for (index, byte) in sample.iter().enumerate() {
		if *byte == 0 {
			if index % 2 == 0 {
				even += 1;
			} else {
				odd += 1;
			}
		}
	}

	// Two thirds of one side being NUL, and decisively more than the other, is UTF-16. A UTF-8
	// file with a stray NUL in it stays on the UTF-8 path.
	let threshold = (sample.len() / 2) * 2 / 3;
	if odd >= threshold.max(1) && odd > even {
		return Some(Utf16::Little);
	}
	if even >= threshold.max(1) && even > odd {
		return Some(Utf16::Big);
	}
	None
}

/// Reads a document, reporting failures the way `readMarkdown` did — with an error dialog.
pub fn read_or_report(app: &AppHandle, path: &Path) -> Option<MarkDocument> {
	match read(path) {
		Ok(doc) => Some(doc),
		Err(error) => {
			app.dialog()
				.message(format!("{}\n\n{error}", path.display()))
				.title("Could not open file")
				.kind(MessageDialogKind::Error)
				.show(|_| {});
			None
		}
	}
}

/// Opens a document from outside the page — the dialog, the command line, a second instance,
/// the OS — in the window `label`: adds it to that window's open set, makes it the active one,
/// and pushes it to the renderer.
///
/// It adds rather than replaces because the renderer owns the open set and follows up with
/// `sync`, which is the source of truth; until it does, the documents already open there must
/// keep reloading on save.
pub fn open(app: &AppHandle, label: &str, path: &Path) {
	let path = resolve(path);
	let Some(doc) = read_or_report(app, &path) else {
		return;
	};

	note_recent(app, &path);

	// Before the document reaches the page, so its assets can be fetched the moment it renders
	// and nothing outside its directory can be.
	with_window(app, label, |window| {
		let mut files = window.watcher.files().to_vec();
		files.push(path.clone());
		window.watcher.reconcile(&files, app, label);
		window.roots.set_document(&path);
	});

	let _ = app.emit_to(label, "document:opened", doc);

	set_title(app, label, Some(&file_name(&path)));
}

/// Replaces the window's open set with the renderer's: watches exactly `open`, and serves
/// `mdr://` from beside `active`. Returns once the roots are in place, so a renderer that
/// awaits it can render with its images resolving on first paint.
///
/// Paths that are not absolute files on disk — the renderer's virtual About document — are
/// neither watched nor made a root. Such a path as `active` still names the window, by its last
/// path segment, so the title reads the same as the tab. An `active` that is a file but not in
/// `open` is served from but not watched: watching follows `open` and nothing else.
pub fn sync(app: &AppHandle, label: &str, open: &[String], active: Option<&str>) {
	let files: Vec<PathBuf> = open.iter().filter_map(|path| on_disk(path)).collect();
	let active_file = active.and_then(on_disk);

	with_window(app, label, |window| {
		window.watcher.reconcile(&files, app, label);
		match &active_file {
			Some(path) => window.roots.set_document(path),
			None => window.roots.clear_document(),
		}
	});

	let name = match (&active_file, active) {
		(Some(path), _) => Some(file_name(path)),
		(None, Some(virtual_path)) => Some(last_segment(virtual_path).to_owned()),
		(None, None) => None,
	};
	set_title(app, label, name.as_deref());
}

/// Scans a folder for the window `label` and pushes the sidebar list, as `promptOpenFolder`
/// did.
pub fn open_folder(app: &AppHandle, label: &str, root: &Path) {
	let root = resolve(root);

	with_window(app, label, |window| window.roots.set_folder(&root));

	let entries = crate::tree::list_markdown_tree(&root);
	let _ = app.emit_to(
		label,
		"folder:opened",
		serde_json::json!({
			"root": root.to_string_lossy(),
			"entries": entries,
		}),
	);
}

/// Adds a document to the OS recent-documents list — the Windows jump list.
///
/// Not during a `--smoke` run, which opens its fixtures through every path that would, and
/// would otherwise leave them in the developer's own list.
pub fn note_recent(app: &AppHandle, path: &Path) {
	let smoke = app.try_state::<AppState>().is_some_and(|state| state.smoke.is_some());
	if !smoke {
		crate::recent::add(path);
	}
}

/// Runs `update` on the window's state, creating it the first time the window opens anything.
fn with_window(app: &AppHandle, label: &str, update: impl FnOnce(&mut crate::WindowState)) {
	if let Some(state) = app.try_state::<AppState>() {
		if let Ok(mut windows) = state.windows.lock() {
			update(windows.entry(label.to_owned()).or_default());
		}
	}
}

/// A path from the renderer, if it names an absolute file on disk. Relative paths are refused
/// rather than resolved: the renderer only ever holds absolute ones, so a relative path is one
/// of its virtual documents, and resolving it against the working directory would invent a
/// root.
fn on_disk(path: &str) -> Option<PathBuf> {
	let path = Path::new(path);
	(path.is_absolute() && path.is_file()).then(|| resolve(path))
}

fn file_name(path: &Path) -> String {
	path.file_name()
		.map(|n| n.to_string_lossy().into_owned())
		.unwrap_or_default()
}

/// The name a virtual document shows as. Split on both separators, since a virtual path follows
/// no platform's rules.
fn last_segment(path: &str) -> &str {
	path.rsplit(['/', '\\'])
		.find(|segment| !segment.is_empty())
		.unwrap_or(path)
}

/// `"<name> — MarkReader"`, or just `"MarkReader"` with nothing active.
fn set_title(app: &AppHandle, label: &str, name: Option<&str>) {
	if let Some(window) = app.get_webview_window(label) {
		let title = match name {
			Some(name) if !name.is_empty() => format!("{name} — MarkReader"),
			_ => "MarkReader".to_owned(),
		};
		let _ = window.set_title(&title);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// UTF-16 fixtures, built the way the editors that produce them do.
	fn utf16(text: &str, order: Utf16, bom: bool) -> Vec<u8> {
		let mut bytes = Vec::new();
		if bom {
			bytes.extend_from_slice(match order {
				Utf16::Little => &BOM_UTF16_LE,
				Utf16::Big => &BOM_UTF16_BE,
			});
		}
		for unit in text.encode_utf16() {
			bytes.extend_from_slice(&match order {
				Utf16::Little => unit.to_le_bytes(),
				Utf16::Big => unit.to_be_bytes(),
			});
		}
		bytes
	}

	#[test]
	fn a_virtual_document_is_named_by_its_last_segment() {
		assert_eq!(last_segment("About MarkReader"), "About MarkReader");
		assert_eq!(last_segment("/virtual/notes/x.md"), "x.md");
		assert_eq!(last_segment(r"virtual\x.md"), "x.md");
		assert_eq!(last_segment("trailing/"), "trailing");
	}

	#[test]
	fn only_absolute_files_on_disk_are_watched_or_served() {
		assert_eq!(on_disk("About MarkReader"), None);
		assert_eq!(on_disk(""), None);
		let dir = std::env::temp_dir();
		// A directory is not a document.
		assert_eq!(on_disk(&dir.to_string_lossy()), None);
		let file = dir.join("markreader-document-on-disk.md");
		std::fs::write(&file, b"# x").expect("fixture file");
		assert_eq!(on_disk(&file.to_string_lossy()), Some(resolve(&file)));
		let _ = std::fs::remove_file(&file);
	}

	#[test]
	fn plain_utf8_is_unchanged() {
		assert_eq!(decode("# Title\n\nBody — ok\n".as_bytes()), "# Title\n\nBody — ok\n");
	}

	#[test]
	fn utf8_bom_is_stripped() {
		let mut bytes = BOM_UTF8.to_vec();
		bytes.extend_from_slice(b"# Title");
		// The BOM must not survive: the renderer looks for `#` at the start of the first line.
		assert_eq!(decode(&bytes), "# Title");
	}

	#[test]
	fn utf16_with_bom_decodes() {
		let text = "# Título\n\nWith an emoji: \u{1F600}\n";
		assert_eq!(decode(&utf16(text, Utf16::Little, true)), text);
		assert_eq!(decode(&utf16(text, Utf16::Big, true)), text);
	}

	#[test]
	fn utf16_without_bom_is_sniffed() {
		let text = "# Heading\n\nA paragraph long enough to sniff.\n";
		assert_eq!(decode(&utf16(text, Utf16::Little, false)), text);
		assert_eq!(decode(&utf16(text, Utf16::Big, false)), text);
	}

	#[test]
	fn empty_input_decodes_to_empty() {
		assert_eq!(decode(&[]), "");
		assert_eq!(decode(&BOM_UTF8), "");
		assert_eq!(decode(&BOM_UTF16_LE), "");
	}

	#[test]
	fn odd_length_utf16_keeps_what_it_can() {
		let mut bytes = utf16("ok", Utf16::Little, true);
		bytes.push(b'!');
		assert_eq!(decode(&bytes), "ok\u{FFFD}");
	}

	#[test]
	fn a_stray_nul_does_not_make_it_utf16() {
		let mut bytes = b"# Title\n\nplain utf-8 prose, one stray byte follows\n".to_vec();
		bytes.push(0);
		bytes.extend_from_slice(b"and more prose after it\n");
		assert!(decode(&bytes).starts_with("# Title"));
	}

	#[test]
	fn invalid_utf8_is_substituted_not_rejected() {
		// Lossy substitution, kept deliberately rather than rejecting the file.
		assert_eq!(decode(&[b'a', 0xFF, 0xFF, b'b']), "a��b");
	}
}
