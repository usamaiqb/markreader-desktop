// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Builds the sidebar file list for an opened folder.
 *--------------------------------------------------------------------------------------------*/

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
	/// Absolute path on disk.
	pub path: String,
	/// Path relative to the opened root, using forward slashes.
	pub relative_path: String,
	pub name: String,
}

const MARKDOWN_EXT: &[&str] = &[
	"md", "markdown", "mdown", "mkdn", "mkd", "mdwn", "mdtxt", "mdtext", "workbook",
];

const SKIP_DIRS: &[&str] = &[
	"node_modules", ".git", ".hg", ".svn", "out", "dist", "build", ".next", ".cache",
	"coverage", ".venv", "venv", "__pycache__", "target", "vendor",
];

const MAX_ENTRIES: usize = 5000;
const MAX_DEPTH: usize = 12;

pub fn is_markdown(path: &Path) -> bool {
	path.extension()
		.and_then(|e| e.to_str())
		.map(|e| MARKDOWN_EXT.contains(&e.to_lowercase().as_str()))
		.unwrap_or(false)
}

/// Recursively collects markdown files under `root`, sorted so shallower paths come first and
/// siblings are alphabetical. Common dependency and build folders are skipped.
pub fn list_markdown_tree(root: &Path) -> Vec<TreeEntry> {
	let mut results = Vec::new();
	walk(root, root, 0, &mut results);

	results.sort_by(|a, b| {
		let depth = |p: &str| p.split('/').count();
		depth(&a.relative_path)
			.cmp(&depth(&b.relative_path))
			.then_with(|| {
				a.relative_path
					.to_lowercase()
					.cmp(&b.relative_path.to_lowercase())
			})
			.then_with(|| a.relative_path.cmp(&b.relative_path))
	});

	results
}

fn walk(root: &Path, dir: &Path, depth: usize, results: &mut Vec<TreeEntry>) {
	if depth > MAX_DEPTH || results.len() >= MAX_ENTRIES {
		return;
	}

	let Ok(entries) = std::fs::read_dir(dir) else {
		return;
	};

	let mut subdirs: Vec<PathBuf> = Vec::new();
	for entry in entries.flatten() {
		if results.len() >= MAX_ENTRIES {
			return;
		}

		let name = entry.file_name().to_string_lossy().into_owned();
		let full = entry.path();
		let Ok(file_type) = entry.file_type() else {
			continue;
		};

		if file_type.is_dir() {
			let lower = name.to_lowercase();
			if !name.starts_with('.') && !SKIP_DIRS.contains(&lower.as_str()) {
				subdirs.push(full);
			}
		} else if file_type.is_file() && is_markdown(&full) {
			results.push(TreeEntry {
				path: full.to_string_lossy().into_owned(),
				relative_path: relative_to(root, &full),
				name,
			});
		}
	}

	subdirs.sort();
	for sub in subdirs {
		walk(root, &sub, depth + 1, results);
	}
}

/// `path.relative(root, full)` with forward slashes, which is what the renderer expects.
fn relative_to(root: &Path, full: &Path) -> String {
	full.strip_prefix(root)
		.unwrap_or(full)
		.to_string_lossy()
		.replace(std::path::MAIN_SEPARATOR, "/")
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;

	/// A throwaway directory the tests create files under and clean up afterwards.
	struct TempRoot(PathBuf);

	impl TempRoot {
		fn new(name: &str) -> Self {
			let root = std::env::temp_dir().join(format!(
				"markreader-tree-test-{}-{name}",
				std::process::id()
			));
			let _ = fs::remove_dir_all(&root);
			fs::create_dir_all(&root).unwrap();
			TempRoot(root)
		}

		/// Writes an empty file at `rel` under the root, creating parent dirs.
		fn write(&self, rel: &str) {
			let full = self.0.join(rel);
			fs::create_dir_all(full.parent().unwrap()).unwrap();
			fs::write(&full, "").unwrap();
		}

		fn paths(&self) -> Vec<String> {
			list_markdown_tree(&self.0)
				.into_iter()
				.map(|e| e.relative_path)
				.collect()
		}
	}

	impl Drop for TempRoot {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.0);
		}
	}

	#[test]
	fn is_markdown_accepts_known_extensions_case_insensitively() {
		for ext in ["md", "markdown", "mdown", "mkdn", "mkd", "mdwn", "mdtxt", "mdtext", "workbook"] {
			assert!(is_markdown(Path::new(&format!("a.{ext}"))), "{ext}");
			assert!(is_markdown(Path::new(&format!("a.{}", ext.to_uppercase()))), "{ext} uppercase");
		}
	}

	#[test]
	fn is_markdown_rejects_other_extensions() {
		for name in ["a.txt", "a.md5", "a", "a.markdown.bak", "README"] {
			assert!(!is_markdown(Path::new(name)), "{name}");
		}
	}

	#[test]
	fn lists_markdown_files_sorted_shallow_first() {
		let root = TempRoot::new("sort");
		root.write("b.md");
		root.write("nested/c.markdown");
		root.write("a.MD");
		root.write("notes/readme.txt");
		assert_eq!(root.paths(), ["a.MD", "b.md", "nested/c.markdown"]);
	}

	#[test]
	fn skips_dependency_build_and_vcs_folders() {
		let root = TempRoot::new("skips");
		for dir in ["node_modules", "dist", "out", "build", "target", "vendor", ".git", ".venv"] {
			root.write(&format!("{dir}/x.md"));
		}
		root.write("keep.md");
		assert_eq!(root.paths(), ["keep.md"]);
	}

	#[test]
	fn relative_paths_use_forward_slashes() {
		let root = TempRoot::new("slashes");
		root.write("deep/nested/file.md");
		let entries = list_markdown_tree(&root.0);
		assert!(!entries[0].relative_path.contains('\\'));
		assert_eq!(entries[0].relative_path, "deep/nested/file.md");
		assert!(Path::new(&entries[0].path).is_absolute());
	}

	#[test]
	fn depth_limit_bounds_the_scan() {
		let root = TempRoot::new("depth");
		let mut shallow = String::new();
		for _ in 0..12 {
			shallow.push_str("d/");
		}
		root.write(&format!("{shallow}included.md"));

		let mut too_deep = String::new();
		for _ in 0..14 {
			too_deep.push_str("d/");
		}
		root.write(&format!("{too_deep}excluded.md"));

		let paths = root.paths();
		assert_eq!(paths, ["d/d/d/d/d/d/d/d/d/d/d/d/included.md"]);
	}
}
