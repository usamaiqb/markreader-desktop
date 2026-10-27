// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Watches a window's open documents so each view reloads on save, using the `notify` crate.
 *--------------------------------------------------------------------------------------------*/

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter};

/// Long enough to coalesce the burst of events a single save produces, short enough that the
/// reload still feels immediate.
const DEBOUNCE: Duration = Duration::from_millis(60);

/// Watches a set of files for one window. The containing directories are watched rather than
/// the files themselves, because many editors save atomically (write a temp file, then rename
/// over the target), which silently invalidates a file-level watch.
///
/// One watch per distinct directory, each with its own debouncer. That keeps every watch
/// scoped to a single directory, so an event can still be matched on its file name alone —
/// comparing full paths would trip over the canonical paths some backends report (FSEvents
/// resolves `/var` to `/private/var`, for one).
#[derive(Default)]
pub struct FileWatcher {
	/// The files asked for, whether or not their directory could be watched — so a directory
	/// that failed to watch is retried on the next reconcile rather than forgotten.
	files: Vec<PathBuf>,
	/// Live directory watches, keyed by `key`.
	dirs: BTreeMap<String, DirWatch>,
}

/// One directory's watch, and the files in it that its events are for.
struct DirWatch {
	/// Shared with the event handler, so a reconcile that keeps the directory can change which
	/// files it reports on without restarting the watch.
	files: Arc<Mutex<Vec<PathBuf>>>,
	/// Dropping it shuts down its thread and releases the watch.
	_debouncer: Debouncer<RecommendedWatcher>,
}

impl FileWatcher {
	/// The files currently asked for.
	pub fn files(&self) -> &[PathBuf] {
		&self.files
	}

	/// Watches exactly `files`, reporting changes to the window `label`. Directories still
	/// needed keep their watch — restarting one would drop any save that lands in the gap —
	/// and only the difference is added or released.
	pub fn reconcile(&mut self, files: &[PathBuf], app: &AppHandle, label: &str) {
		let wanted = group(files);
		let plan = plan(self.dirs.keys(), &wanted);

		for key in &plan.remove {
			self.dirs.remove(key);
		}
		for (key, watch) in &self.dirs {
			if let (Some(group), Ok(mut current)) = (wanted.get(key), watch.files.lock()) {
				current.clone_from(&group.files);
			}
		}
		for key in &plan.add {
			let group = &wanted[key];
			if let Some(watch) = DirWatch::start(group, app.clone(), label.to_owned()) {
				self.dirs.insert(key.clone(), watch);
			}
		}

		self.files = wanted.into_values().flat_map(|group| group.files).collect();
	}

	pub fn dispose(&mut self) {
		self.dirs.clear();
		self.files.clear();
	}
}

impl DirWatch {
	fn start(group: &Group, app: AppHandle, label: String) -> Option<Self> {
		let files = Arc::new(Mutex::new(group.files.clone()));

		let watched = Arc::clone(&files);
		let handler = move |result: DebounceEventResult| {
			let Ok(events) = result else {
				return;
			};
			let Ok(watched) = watched.lock().map(|files| files.clone()) else {
				return;
			};
			let events: Vec<PathBuf> = events.into_iter().map(|event| event.path).collect();
			for file in changed(&events, &watched) {
				// A save that is still in flight (temp file renamed away) shows up as a delete.
				if !file.exists() {
					continue;
				}
				if let Ok(doc) = crate::document::read(file) {
					let _ = app.emit_to(&label, "document:changed", doc);
				}
			}
		};

		// Watching is best-effort; the reader still works without live reload.
		let mut debouncer = new_debouncer(DEBOUNCE, handler).ok()?;
		debouncer
			.watcher()
			.watch(&group.dir, RecursiveMode::NonRecursive)
			.ok()?;
		Some(Self {
			files,
			_debouncer: debouncer,
		})
	}
}

/// The files of one directory.
#[derive(Debug, PartialEq)]
struct Group {
	dir: PathBuf,
	files: Vec<PathBuf>,
}

/// Groups files by the directory that has to be watched for them, dropping duplicates — the
/// same file asked for twice would otherwise be reported twice per save.
fn group(files: &[PathBuf]) -> BTreeMap<String, Group> {
	let mut groups: BTreeMap<String, Group> = BTreeMap::new();
	for file in files {
		let Some(dir) = file.parent() else {
			continue;
		};
		let group = groups.entry(key(dir.as_os_str())).or_insert_with(|| Group {
			dir: dir.to_path_buf(),
			files: Vec::new(),
		});
		if !group.files.iter().any(|known| same_name(known, file)) {
			group.files.push(file.clone());
		}
	}
	groups
}

/// Which directory watches a reconcile starts and which it releases.
#[derive(Debug, Default, PartialEq)]
struct Plan {
	add: Vec<String>,
	remove: Vec<String>,
}

fn plan<'a>(current: impl Iterator<Item = &'a String>, wanted: &BTreeMap<String, Group>) -> Plan {
	let current: Vec<&String> = current.collect();
	Plan {
		add: wanted
			.keys()
			.filter(|key| !current.contains(key))
			.cloned()
			.collect(),
		remove: current
			.into_iter()
			.filter(|key| !wanted.contains_key(*key))
			.cloned()
			.collect(),
	}
}

/// The watched files a batch of events from one directory is about.
fn changed<'a>(events: &[PathBuf], files: &'a [PathBuf]) -> Vec<&'a Path> {
	files
		.iter()
		.filter(|file| events.iter().any(|event| same_name(event, file)))
		.map(PathBuf::as_path)
		.collect()
}

/// Windows paths are compared case-insensitively, so `C:\Docs` and `c:\docs` share a watch.
fn key(name: &OsStr) -> String {
	let name = name.to_string_lossy();
	if cfg!(windows) {
		name.to_lowercase()
	} else {
		name.into_owned()
	}
}

/// Each watch is scoped to one directory, so comparing file names is enough — and it is
/// what the old watcher did. Windows file names are compared case-insensitively.
fn same_name(a: &Path, b: &Path) -> bool {
	match (a.file_name(), b.file_name()) {
		(Some(x), Some(y)) => key(x) == key(y),
		_ => false,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn paths(list: &[&str]) -> Vec<PathBuf> {
		list.iter().map(PathBuf::from).collect()
	}

	fn keys(list: &[&str]) -> Vec<String> {
		list.iter().map(|dir| key(OsStr::new(dir))).collect()
	}

	#[test]
	fn files_in_one_directory_share_a_watch() {
		let groups = group(&paths(&["/docs/a.md", "/docs/b.md", "/notes/c.md"]));
		assert_eq!(groups.len(), 2);
		assert_eq!(groups[&key(OsStr::new("/docs"))].files, paths(&["/docs/a.md", "/docs/b.md"]));
		assert_eq!(groups[&key(OsStr::new("/notes"))].dir, PathBuf::from("/notes"));
	}

	#[test]
	fn a_file_asked_for_twice_is_watched_once() {
		let groups = group(&paths(&["/docs/a.md", "/docs/a.md"]));
		assert_eq!(groups[&key(OsStr::new("/docs"))].files, paths(&["/docs/a.md"]));
	}

	#[cfg(windows)]
	#[test]
	fn windows_directories_and_names_ignore_case() {
		let groups = group(&paths(&[r"C:\Docs\A.md", r"c:\docs\a.md", r"C:\DOCS\b.md"]));
		assert_eq!(groups.len(), 1);
		assert_eq!(
			groups[&key(OsStr::new(r"c:\docs"))].files,
			paths(&[r"C:\Docs\A.md", r"C:\DOCS\b.md"])
		);
	}

	#[test]
	fn reconciling_adds_and_releases_only_the_difference() {
		let current = keys(&["/docs", "/old"]);
		let wanted = group(&paths(&["/docs/a.md", "/new/b.md"]));
		assert_eq!(
			plan(current.iter(), &wanted),
			Plan {
				add: keys(&["/new"]),
				remove: keys(&["/old"]),
			}
		);
	}

	#[test]
	fn reconciling_to_the_same_directories_changes_no_watch() {
		// Swapping which file of a directory is open must not restart that directory's watch.
		let current = keys(&["/docs"]);
		let wanted = group(&paths(&["/docs/other.md"]));
		assert_eq!(plan(current.iter(), &wanted), Plan::default());
	}

	#[test]
	fn reconciling_to_nothing_releases_everything() {
		let current = keys(&["/docs", "/notes"]);
		assert_eq!(
			plan(current.iter(), &group(&[])),
			Plan {
				add: vec![],
				remove: keys(&["/docs", "/notes"]),
			}
		);
	}

	#[test]
	fn an_event_reports_only_the_files_it_names() {
		let files = paths(&["/docs/a.md", "/docs/b.md"]);
		// The temp file of an atomic save is ignored; the rename onto `a.md` is what counts.
		let events = paths(&["/docs/.a.md.swp", "/docs/a.md"]);
		assert_eq!(changed(&events, &files), vec![Path::new("/docs/a.md")]);
	}

	#[test]
	fn an_event_for_an_unwatched_file_reports_nothing() {
		let files = paths(&["/docs/a.md"]);
		let events = paths(&["/docs/unrelated.md"]);
		assert!(changed(&events, &files).is_empty());
	}
}
