// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  The `mdr://` scheme — the reason document-relative images and links work at all:
 *  rewriting them to this scheme is what replaces VS Code's `asWebviewUri()`.
 *--------------------------------------------------------------------------------------------*/

use std::path::PathBuf;

use percent_encoding::percent_decode_str;
use tauri::{http, Runtime, UriSchemeContext, UriSchemeResponder};

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
	_context: UriSchemeContext<'_, R>,
	request: http::Request<Vec<u8>>,
	responder: UriSchemeResponder,
) {
	// Reading from disk on the webview's own thread stalls it, so the request is answered
	// asynchronously.
	let uri = request.uri().clone();
	std::thread::spawn(move || responder.respond(serve(&uri)));
}

fn serve(uri: &http::Uri) -> http::Response<Vec<u8>> {
	let Some(path) = file_path(uri) else {
		return error(http::StatusCode::NOT_FOUND, "Not found");
	};

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
