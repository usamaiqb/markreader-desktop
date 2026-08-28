// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Watches the open document so the view reloads on save, using the `notify` crate.
 *--------------------------------------------------------------------------------------------*/

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter};

/// Long enough to coalesce the burst of events a single save produces, short enough that the
/// reload still feels immediate.
const DEBOUNCE: Duration = Duration::from_millis(60);

/// Watches a single file. The containing directory is watched rather than the file itself,
/// because many editors save atomically (write a temp file, then rename over the target),
/// which silently invalidates a file-level watch.
#[derive(Default)]
pub struct FileWatcher {
	debouncer: Option<Debouncer<RecommendedWatcher>>,
	target: Option<PathBuf>,
}

impl FileWatcher {
	pub fn watch(&mut self, file: &Path, app: AppHandle) {
		let target = crate::document::resolve(file);
		if self.target.as_deref() == Some(target.as_path()) && self.debouncer.is_some() {
			return;
		}

		self.dispose();

		let Some(dir) = target.parent().map(Path::to_path_buf) else {
			return;
		};

		let watched = target.clone();
		let handler = move |result: DebounceEventResult| {
			let Ok(events) = result else {
				return;
			};
			if !events.iter().any(|event| same_name(&event.path, &watched)) {
				return;
			}
			// A save that is still in flight (temp file renamed away) shows up as a delete.
			if !watched.exists() {
				return;
			}
			if let Ok(doc) = crate::document::read(&watched) {
				let _ = app.emit("document:changed", doc);
			}
		};

		// Watching is best-effort; the reader still works without live reload.
		if let Ok(mut debouncer) = new_debouncer(DEBOUNCE, handler) {
			if debouncer
				.watcher()
				.watch(&dir, RecursiveMode::NonRecursive)
				.is_ok()
			{
				self.debouncer = Some(debouncer);
				self.target = Some(target);
			}
		}
	}

	/// Dropping the debouncer shuts down its thread and releases the watch.
	pub fn dispose(&mut self) {
		self.debouncer = None;
		self.target = None;
	}
}

/// The directory watch already scopes events, so comparing file names is enough — and it is
/// what the old watcher did. Windows file names are compared case-insensitively.
fn same_name(a: &Path, b: &Path) -> bool {
	fn key(path: &Path) -> Option<String> {
		let name: &OsStr = path.file_name()?;
		let name = name.to_string_lossy();
		Some(if cfg!(windows) {
			name.to_lowercase()
		} else {
			name.into_owned()
		})
	}

	match (key(a), key(b)) {
		(Some(x), Some(y)) => x == y,
		_ => false,
	}
}
