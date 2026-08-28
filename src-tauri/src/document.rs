// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Opening, reading and watching the current document — path resolution, encoding detection,
 *  and the events the frontend listens for.
 *--------------------------------------------------------------------------------------------*/

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::{AppState, WINDOW_LABEL};

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

/// Opens a document, starts watching it for changes, and pushes it to the renderer.
pub fn open(app: &AppHandle, path: &Path) {
	let path = resolve(path);
	let Some(doc) = read_or_report(app, &path) else {
		return;
	};

	crate::recent::add(&path);

	if let Some(state) = app.try_state::<AppState>() {
		if let Ok(mut watcher) = state.watcher.lock() {
			watcher.watch(&path, app.clone());
		}
	}

	let _ = app.emit("document:opened", doc);

	if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
		let name = path
			.file_name()
			.map(|n| n.to_string_lossy().into_owned())
			.unwrap_or_default();
		let _ = window.set_title(&format!("{name} — MarkReader"));
	}
}

/// Scans a folder and pushes the sidebar list, as `promptOpenFolder` did.
pub fn open_folder(app: &AppHandle, root: &Path) {
	let root = resolve(root);
	let entries = crate::tree::list_markdown_tree(&root);
	let _ = app.emit(
		"folder:opened",
		serde_json::json!({
			"root": root.to_string_lossy(),
			"entries": entries,
		}),
	);
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
