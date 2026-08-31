// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The `mdr://` scheme — the reason document-relative images and links work at all:
 *  rewriting them to this scheme is what replaces VS Code's `asWebviewUri()`.
 *--------------------------------------------------------------------------------------------*/

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::{http, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::AppState;

/// The directories this scheme will serve from.
///
/// Without it the scheme served any absolute path the page asked for, and the page renders
/// untrusted documents — so a hostile document could read a file anywhere on disk and beacon
/// it out through an image URL, which the CSP has to permit for documents that legitimately
/// reference remote images. Scoping the reads is what closes that, and it mirrors the
/// `localResourceRoots` of the VS Code webview this preview came from.
///
/// Two slots rather than a growing set: a document may reference assets beside itself, and
/// anything inside the opened folder. Both are replaced as you navigate, so leaving a document
/// takes its directory's permission with it.
#[derive(Default)]
pub struct ResourceRoots {
	/// Directory holding the document currently open.
	document: Option<PathBuf>,
	/// The opened folder, when there is one.
	folder: Option<PathBuf>,
}

impl ResourceRoots {
	pub fn set_document(&mut self, document: &Path) {
		self.document = document.parent().map(canonical);
	}

	pub fn set_folder(&mut self, folder: &Path) {
		self.folder = Some(canonical(folder));
	}

	fn snapshot(&self) -> Vec<PathBuf> {
		self.document.iter().chain(self.folder.iter()).cloned().collect()
	}
}

/// Falls back to the path as given when it will not canonicalize; a root that does not resolve
/// then matches nothing, which fails closed.
fn canonical(path: &Path) -> PathBuf {
	std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Whether a requested file sits inside one of the allowed roots. Canonicalized first, so
/// neither a `..` segment nor a symlink can point out of them.
fn is_allowed(path: &Path, roots: &[PathBuf]) -> bool {
	let Ok(resolved) = std::fs::canonicalize(path) else {
		return false;
	};
	roots.iter().any(|root| resolved.starts_with(root))
}

/// Content types for the asset kinds a markdown document can reference.
const MIME_TYPES: &[(&str, &str)] = &[
	("png", "image/png"),
	("jpg", "image/jpeg"),
	("jpeg", "image/jpeg"),
	("gif", "image/gif"),
	("webp", "image/webp"),
	("avif", "image/avif"),
	("bmp", "image/bmp"),
	("ico", "image/x-icon"),
	("svg", "image/svg+xml"),
	("mp4", "video/mp4"),
	("webm", "video/webm"),
	("ogg", "video/ogg"),
	("mp3", "audio/mpeg"),
	("wav", "audio/wav"),
	("woff", "font/woff"),
	("woff2", "font/woff2"),
	("ttf", "font/ttf"),
	("css", "text/css"),
];

pub fn handle<R: Runtime>(
	context: UriSchemeContext<'_, R>,
	request: http::Request<Vec<u8>>,
	responder: UriSchemeResponder,
) {
	// Snapshotted here rather than in the thread: the state lock should not be taken on a
	// worker while the UI may be writing it.
	let roots = context
		.app_handle()
		.try_state::<AppState>()
		.and_then(|state| state.resource_roots.lock().ok().map(|roots| roots.snapshot()))
		.unwrap_or_default();

	// Reading from disk on the webview's own thread stalls it, so the request is answered
	// asynchronously.
	let uri = request.uri().clone();
	std::thread::spawn(move || responder.respond(serve(&uri, &roots)));
}

fn serve(uri: &http::Uri, roots: &[PathBuf]) -> http::Response<Vec<u8>> {
	let Some(path) = file_path(uri) else {
		return error(http::StatusCode::NOT_FOUND, "Not found");
	};

	// 404 rather than 403: a refusal that distinguishes the two tells a document which files
	// exist outside its roots.
	if !is_allowed(&path, roots) {
		return error(http::StatusCode::NOT_FOUND, "Not found");
	}

	match std::fs::metadata(&path) {
		Ok(metadata) if !metadata.is_file() => {
			return error(http::StatusCode::NOT_FOUND, "Not a file")
		}
		Err(_) => return error(http::StatusCode::NOT_FOUND, "Not found"),
		Ok(_) => {}
	}

	let Ok(bytes) = std::fs::read(&path) else {
		return error(http::StatusCode::NOT_FOUND, "Not found");
	};

	let mime = path
		.extension()
		.and_then(|e| e.to_str())
		.map(str::to_lowercase)
		.and_then(|ext| {
			MIME_TYPES
				.iter()
				.find(|(name, _)| *name == ext)
				.map(|(_, mime)| *mime)
		})
		.unwrap_or("application/octet-stream");

	http::Response::builder()
		.status(http::StatusCode::OK)
		.header(http::header::CONTENT_TYPE, mime)
		.header(http::header::CACHE_CONTROL, "no-cache")
		// The page and this scheme are separate origins, and media elements ask for CORS.
		.header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
		.body(bytes)
		.unwrap_or_else(|_| error(http::StatusCode::INTERNAL_SERVER_ERROR, "Failed"))
}

/// `mdr://localhost/C%3A/x/y.png` becomes `C:/x/y.png`. On Windows the runtime rewrites the
/// scheme to `http://mdr.localhost/...` before it reaches us (WebView2 supports no custom
/// schemes), so both hosts are accepted.
fn file_path(uri: &http::Uri) -> Option<PathBuf> {
	match uri.host() {
		Some("localhost") | Some("mdr.localhost") => {}
		_ => return None,
	}

	let decoded = percent_decode_str(uri.path()).decode_utf8().ok()?;
	let mut path: &str = decoded.as_ref();

	// `/C:/x` -> `C:/x` on Windows; POSIX paths keep their leading slash.
	let bytes = path.as_bytes();
	if bytes.len() > 2 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
		path = &path[1..];
	}

	if path.is_empty() || path == "/" {
		return None;
	}

	Some(PathBuf::from(path))
}

fn error(status: http::StatusCode, message: &str) -> http::Response<Vec<u8>> {
	http::Response::builder()
		.status(status)
		.header(http::header::CONTENT_TYPE, "text/plain")
		.body(message.as_bytes().to_vec())
		.expect("static error response is well formed")
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A directory laid out as `<base>/docs/a.png` and `<base>/secret.txt`, so "inside the
	/// document's folder" and "one step outside it" are both real paths on disk —
	/// `is_allowed` canonicalizes, so nothing here can be faked with strings.
	struct Fixture {
		base: PathBuf,
	}

	impl Fixture {
		fn new(name: &str) -> Self {
			let base = std::env::temp_dir().join(format!("markreader-protocol-{name}"));
			let _ = std::fs::remove_dir_all(&base);
			std::fs::create_dir_all(base.join("docs")).expect("fixture dirs");
			std::fs::write(base.join("docs").join("a.png"), b"png").expect("inside file");
			std::fs::write(base.join("secret.txt"), b"secret").expect("outside file");
			Self { base }
		}

		fn docs(&self) -> PathBuf {
			canonical(&self.base.join("docs"))
		}
	}

	impl Drop for Fixture {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.base);
		}
	}

	#[test]
	fn serves_a_file_inside_an_allowed_root() {
		let fixture = Fixture::new("inside");
		assert!(is_allowed(&fixture.base.join("docs").join("a.png"), &[fixture.docs()]));
	}

	#[test]
	fn refuses_a_file_outside_every_root() {
		let fixture = Fixture::new("outside");
		assert!(!is_allowed(&fixture.base.join("secret.txt"), &[fixture.docs()]));
	}

	#[test]
	fn refuses_a_traversal_out_of_a_root() {
		// The renderer collapses `..` before a path ever gets here, but nothing stops a
		// document asking for `mdr://localhost/…/docs/../secret.txt` directly.
		let fixture = Fixture::new("traversal");
		let traversal = fixture.base.join("docs").join("..").join("secret.txt");
		assert!(!is_allowed(&traversal, &[fixture.docs()]));
	}

	#[test]
	fn refuses_everything_when_no_root_is_set() {
		// The state before any document is open. Failing closed matters most here.
		let fixture = Fixture::new("noroot");
		assert!(!is_allowed(&fixture.base.join("docs").join("a.png"), &[]));
	}

	#[test]
	fn refuses_a_file_that_does_not_exist() {
		let fixture = Fixture::new("missing");
		assert!(!is_allowed(&fixture.base.join("docs").join("nope.png"), &[fixture.docs()]));
	}

	#[test]
	fn the_opened_folder_is_a_root_alongside_the_document() {
		let fixture = Fixture::new("folder");
		let mut roots = ResourceRoots::default();
		roots.set_document(&fixture.base.join("docs").join("index.md"));
		roots.set_folder(&fixture.base);
		// `secret.txt` is outside the document's directory but inside the opened folder.
		assert!(is_allowed(&fixture.base.join("secret.txt"), &roots.snapshot()));
	}
}
