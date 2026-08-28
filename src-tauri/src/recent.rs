// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Recent documents. On Windows this is `SHAddToRecentDocs`, which is what the OS jump list
 *  and the Start menu's recent-files section read.
 *--------------------------------------------------------------------------------------------*/

use std::path::Path;

#[cfg(windows)]
pub fn add(path: &Path) {
	use std::os::windows::ffi::OsStrExt;
	use windows::Win32::UI::Shell::{SHAddToRecentDocs, SHARD_PATHW};

	let wide: Vec<u16> = path
		.as_os_str()
		.encode_wide()
		.chain(std::iter::once(0))
		.collect();

	// The jump list is a nicety; there is nothing to do if the shell declines.
	unsafe {
		SHAddToRecentDocs(
			SHARD_PATHW.0 as u32,
			Some(wide.as_ptr() as *const std::ffi::c_void),
		);
	}
}

#[cfg(not(windows))]
pub fn add(_path: &Path) {
	// macOS keeps its own recent-documents list through the app menu; nothing to do here.
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The shell call is best-effort; the contract is only that `add` never fails the caller.
	#[test]
	fn add_never_panics() {
		add(Path::new("C:/tmp/some/file.md"));
		add(Path::new("/tmp/some/file.md"));
		add(Path::new("relative.md"));
	}
}
