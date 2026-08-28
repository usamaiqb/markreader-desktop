// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Application menu. View-state items just message the renderer,
 *  which owns that state, so the item ids below double as the IPC channel names.
 *--------------------------------------------------------------------------------------------*/

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{commands, AppState, WINDOW_LABEL};

/// Zoom step — a factor of 1.2 per press.
const ZOOM_STEP: f64 = 1.2;
const ZOOM_MIN: f64 = 0.25;
const ZOOM_MAX: f64 = 5.0;

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
	let item = |id: &str, label: &str, accelerator: Option<&str>| {
		let mut builder = MenuItemBuilder::with_id(id, label);
		if let Some(accelerator) = accelerator {
			builder = builder.accelerator(accelerator);
		}
		builder.build(app)
	};

	let file = SubmenuBuilder::new(app, "&File")
		.item(&item("open_file", "Open File…", Some("CmdOrCtrl+O"))?)
		.item(&item("open_folder", "Open Folder…", Some("CmdOrCtrl+Shift+O"))?)
		.separator()
		.item(&item("reload", "Reload Document", Some("CmdOrCtrl+R"))?)
		.separator();
	let file = if cfg!(target_os = "macos") {
		file.close_window()
	} else {
		file.quit()
	}
	.build()?;

	let edit = SubmenuBuilder::new(app, "&Edit")
		.copy()
		.select_all()
		.separator()
		.item(&item("find", "Find in Document…", Some("CmdOrCtrl+F"))?)
		.build()?;

	let theme = SubmenuBuilder::new(app, "Theme")
		.item(&item("theme_system", "Follow System", None)?)
		.item(&item("theme_light", "Light", None)?)
		.item(&item("theme_dark", "Dark", None)?)
		.build()?;

	let front_matter = SubmenuBuilder::new(app, "Render Front Matter")
		.item(&item("front_matter_table", "As Table", None)?)
		.item(&item("front_matter_code", "As Code Block", None)?)
		.item(&item("front_matter_hide", "Hide", None)?)
		.build()?;

	let view = SubmenuBuilder::new(app, "&View")
		.item(&item("toggle_sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?)
		.item(&item("toggle_toc", "Toggle Outline", Some("CmdOrCtrl+Shift+B"))?)
		.separator()
		.item(&theme)
		.item(&item("cycle_theme", "Toggle Light/Dark", Some("CmdOrCtrl+K"))?)
		.separator()
		.item(&item("word_wrap", "Word Wrap in Code Blocks", None)?)
		.item(&item("math", "Math (KaTeX)", None)?)
		.item(&item("mermaid", "Mermaid Diagrams", None)?)
		.item(&front_matter)
		.separator()
		.item(&item("zoom_reset", "Reset Zoom", Some("CmdOrCtrl+0"))?)
		.item(&item("zoom_in", "Zoom In", Some("CmdOrCtrl+="))?)
		.item(&item("zoom_out", "Zoom Out", Some("CmdOrCtrl+-"))?)
		.separator()
		.item(&item("fullscreen", "Toggle Full Screen", Some("F11"))?)
		.item(&item("devtools", "Toggle Developer Tools", Some("CmdOrCtrl+Shift+I"))?)
		.build()?;

	let versions = format!(
		"Tauri {} · WebView {}",
		tauri::VERSION,
		tauri::webview_version().unwrap_or_else(|_| "unknown".into())
	);
	let help = SubmenuBuilder::new(app, "&Help")
		.item(&item("about", "About MarkReader", None)?)
		.item(
			&MenuItemBuilder::with_id("versions", versions)
				.enabled(false)
				.build(app)?,
		)
		.build()?;

	let mut menu = MenuBuilder::new(app);
	if cfg!(target_os = "macos") {
		// The standard macOS application menu.
		let app_menu = SubmenuBuilder::new(app, "MarkReader")
			.about(None)
			.separator()
			.services()
			.separator()
			.hide()
			.hide_others()
			.show_all()
			.separator()
			.quit()
			.build()?;
		menu = menu.item(&app_menu);
	}

	menu.items(&[&file, &edit, &view, &help]).build()
}

/// Routes a menu click. Anything the renderer owns is forwarded on the channel it already
/// listens to; the rest is window work the backend has to do itself.
pub fn handle_event(app: &AppHandle, id: &str) {
	match id {
		"open_file" => commands::open_file_dialog(app.clone()),
		"open_folder" => commands::open_folder_dialog(app.clone()),
		"reload" => emit(app, "command:reloadDocument", ()),
		"find" => emit(app, "command:find", ()),
		"toggle_sidebar" => emit(app, "command:toggleSidebar", ()),
		"toggle_toc" => emit(app, "command:toggleToc", ()),
		"cycle_theme" => emit(app, "command:cycleTheme", ()),
		"theme_system" => emit(app, "command:setTheme", "system"),
		"theme_light" => emit(app, "command:setTheme", "light"),
		"theme_dark" => emit(app, "command:setTheme", "dark"),
		"word_wrap" => emit(app, "command:toggleWordWrap", ()),
		"math" => emit(app, "command:toggleMath", ()),
		"mermaid" => emit(app, "command:toggleMermaid", ()),
		"front_matter_table" => emit(app, "command:setFrontMatter", "table"),
		"front_matter_code" => emit(app, "command:setFrontMatter", "codeBlock"),
		"front_matter_hide" => emit(app, "command:setFrontMatter", "hide"),
		"about" => emit(app, "command:about", ()),
		"zoom_reset" => zoom(app, None),
		"zoom_in" => zoom(app, Some(ZOOM_STEP)),
		"zoom_out" => zoom(app, Some(1.0 / ZOOM_STEP)),
		"fullscreen" => toggle_fullscreen(app),
		"devtools" => toggle_devtools(app),
		_ => {}
	}
}

fn emit<P: serde::Serialize + Clone>(app: &AppHandle, channel: &str, payload: P) {
	let _ = app.emit(channel, payload);
}

/// `factor: None` resets, otherwise the current zoom is multiplied by it.
fn zoom(app: &AppHandle, factor: Option<f64>) {
	let Some(state) = app.try_state::<AppState>() else {
		return;
	};
	let Ok(mut current) = state.zoom.lock() else {
		return;
	};

	*current = match factor {
		None => 1.0,
		Some(factor) => (*current * factor).clamp(ZOOM_MIN, ZOOM_MAX),
	};

	if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
		let _ = window.set_zoom(*current);
	}
}

fn toggle_fullscreen(app: &AppHandle) {
	if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
		let is_fullscreen = window.is_fullscreen().unwrap_or(false);
		let _ = window.set_fullscreen(!is_fullscreen);
	}
}

fn toggle_devtools(app: &AppHandle) {
	#[cfg(any(debug_assertions, feature = "devtools"))]
	if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
		if window.is_devtools_open() {
			window.close_devtools();
		} else {
			window.open_devtools();
		}
	}
	#[cfg(not(any(debug_assertions, feature = "devtools")))]
	let _ = app;
}
