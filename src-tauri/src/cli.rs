// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Command line parsing — the document path and smoke-test flags the app was launched with.
 *--------------------------------------------------------------------------------------------*/

use std::path::PathBuf;

#[derive(Debug, Default, Clone)]
pub struct Cli {
	/// First argument that is an existing file, e.g. `markreader README.md`.
	pub file: Option<PathBuf>,
	/// Test hook: a script to evaluate in the webview once the document is up.
	pub smoke_script: Option<PathBuf>,
	/// Where the smoke run should write its JSON report, if anywhere.
	pub smoke_out: Option<PathBuf>,
	/// Folder the smoke run scans for its sidebar checks; defaults to the working directory.
	pub smoke_root: Option<PathBuf>,
}

/// Parses the arguments after the executable path. Anything that starts with `-` is skipped:
/// the OS and the webview both add flags of their own.
pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Cli {
	let mut cli = Cli::default();
	let mut args = args.into_iter().peekable();

	while let Some(arg) = args.next() {
		match arg.as_str() {
			"--smoke" => cli.smoke_script = args.next().map(PathBuf::from),
			"--smoke-out" => cli.smoke_out = args.next().map(PathBuf::from),
			"--smoke-root" => cli.smoke_root = args.next().map(PathBuf::from),
			_ if arg.starts_with('-') => continue,
			_ if cli.file.is_none() => {
				let path = PathBuf::from(&arg);
				if path.is_file() {
					cli.file = Some(crate::document::resolve(&path));
				}
			}
			_ => continue,
		}
	}

	cli
}

/// The arguments of this process, minus the executable path.
pub fn from_env() -> Cli {
	parse(std::env::args().skip(1))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs::File;

	/// Creates a real file so the `path.is_file()` gate in `parse` has something to see.
	fn temp_file(name: &str) -> PathBuf {
		let path = std::env::temp_dir().join(format!(
			"markreader-cli-test-{}-{name}",
			std::process::id()
		));
		File::create(&path).unwrap();
		path
	}

	#[test]
	fn captures_the_first_existing_file() {
		let first = temp_file("first.md");
		let second = temp_file("second.md");
		let cli = parse([
			first.to_string_lossy().into_owned(),
			second.to_string_lossy().into_owned(),
		]);
		assert_eq!(cli.file, Some(crate::document::resolve(&first)));
		let _ = std::fs::remove_file(&first);
		let _ = std::fs::remove_file(&second);
	}

	#[test]
	fn ignores_a_missing_file_argument() {
		let cli = parse([format!("{}-definitely-missing.md", std::process::id())]);
		assert!(cli.file.is_none());
	}

	#[test]
	fn skips_flag_values_and_unknown_flags() {
		let file = temp_file("flags.md");
		let cli = parse([
			"--verbose".to_string(),
			"--smoke".to_string(),
			"script.js".to_string(),
			"--smoke-out".to_string(),
			"report.json".to_string(),
			"--smoke-root".to_string(),
			"C:/work".to_string(),
			file.to_string_lossy().into_owned(),
		]);
		assert_eq!(cli.smoke_script, Some(PathBuf::from("script.js")));
		assert_eq!(cli.smoke_out, Some(PathBuf::from("report.json")));
		assert_eq!(cli.smoke_root, Some(PathBuf::from("C:/work")));
		assert_eq!(cli.file, Some(crate::document::resolve(&file)));
		let _ = std::fs::remove_file(&file);
	}

	#[test]
	fn a_flag_value_is_consumed_even_if_it_is_not_a_file() {
		let cli = parse(["--smoke".to_string(), "no-such-script.js".to_string()]);
		assert_eq!(cli.smoke_script, Some(PathBuf::from("no-such-script.js")));
		assert!(cli.file.is_none());
	}
}
