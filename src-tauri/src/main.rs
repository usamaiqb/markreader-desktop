// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  MarkReader — Tauri backend.
 *
 *  Process setup and the single window: this file owns the app state, registers the commands
 *  in `commands.rs`, installs the `mdr://` handler from `protocol.rs`, and builds the menu.
 *  Document opening and watching live in `document.rs` and `watcher.rs`; the frontend half of
 *  the IPC contract is `src/bridge/bridge.ts`.
 *--------------------------------------------------------------------------------------------*/

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;
mod document;
mod menu;
mod protocol;
mod recent;
mod settings;
mod smoke;
mod tree;
mod watcher;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Duration;

use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const WINDOW_LABEL: &str = "main";

/// Painted behind the page so resizing never flashes white. The renderer keeps it in step
/// with the theme through `set_window_background`.
const BACKGROUND: Color = Color(0x1f, 0x1f, 0x1f, 0xff);

/// How long to wait for the frontend to report in before showing the window regardless.
const READY_FALLBACK: Duration = Duration::from_secs(2);

/// Everything the commands, the menu and the watcher need to reach.
pub struct AppState {
	pub watcher: Mutex<watcher::FileWatcher>,
	pub zoom: Mutex<f64>,
	/// Document from the command line, held until the frontend has listeners attached.
	pub startup_file: Mutex<Option<PathBuf>>,
	pub window_shown: AtomicBool,
	pub smoke: Option<smoke::Smoke>,
}

fn main() {
	let cli = cli::from_env();

	#[cfg(windows)]
	if cli.smoke_script.is_some() {
		attach_parent_console();
	}

	let state = AppState {
		watcher: Mutex::new(watcher::FileWatcher::default()),
		zoom: Mutex::new(1.0),
		startup_file: Mutex::new(cli.file.clone()),
		window_shown: AtomicBool::new(false),
		smoke: cli
			.smoke_script
			.clone()
			.map(|script| smoke::Smoke::new(script, cli.smoke_out.clone())),
	};

	tauri::Builder::default()
		// Replaces `requestSingleInstanceLock` + the `second-instance` event: a second launch
		// hands its arguments over and exits.
		.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
			if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
				if window.is_minimized().unwrap_or(false) {
					let _ = window.unminimize();
				}
				let _ = window.set_focus();
			}
			if let Some(file) = cli::parse(argv.into_iter().skip(1)).file {
				document::open(app, &file);
			}
		}))
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_opener::init())
		.manage(state)
		.register_asynchronous_uri_scheme_protocol("mdr", protocol::handle)
		.invoke_handler(tauri::generate_handler![
			commands::open_file_dialog,
			commands::open_folder_dialog,
			commands::open_document,
			commands::open_folder,
			commands::read_document,
			commands::open_external,
			commands::reveal_in_folder,
			commands::set_window_background,
			commands::save_settings,
			commands::frontend_ready,
			smoke::smoke_report,
			smoke::smoke_append,
		])
		.on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
		.setup(move |app| {
			let handle = app.handle().clone();
			let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
				.title("MarkReader")
				.inner_size(1100.0, 820.0)
				.min_inner_size(480.0, 320.0)
				.background_color(BACKGROUND)
				.visible(false)
				.on_navigation(move |url| allow_navigation(&handle, url))
				// Stored settings, handed to the page before any of its own scripts run — see
				// settings.rs.
				.initialization_script(settings::init_script(app.handle()));

			if cli.smoke_script.is_some() {
				let scan_root = cli
					.smoke_root
					.clone()
					.unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
				let settings = app
					.try_state::<AppState>()
					.and_then(|state| state.smoke.as_ref().and_then(smoke::Smoke::settings_path));
				builder = builder.initialization_script(smoke::init_script(
					cli.file.as_deref(),
					&scan_root,
					settings.as_deref(),
				));
			}

			builder.build()?;

			app.set_menu(menu::build(app.handle())?)?;

			// If the frontend never reports in — a script error, say — show the window anyway
			// rather than leaving an invisible process behind.
			let handle = app.handle().clone();
			std::thread::spawn(move || {
				std::thread::sleep(READY_FALLBACK);
				commands::show_window(&handle);
			});

			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("failed to start MarkReader")
		.run(|app, event| match event {
			// macOS: double-clicking a .md in Finder.
			#[cfg(target_os = "macos")]
			tauri::RunEvent::Opened { urls } => {
				for url in urls {
					if let Ok(path) = url.to_file_path() {
						if path.is_file() {
							document::open(app, &path);
							break;
						}
					}
				}
			}
			tauri::RunEvent::Exit => {
				if let Some(state) = app.try_state::<AppState>() {
					if let Ok(mut watcher) = state.watcher.lock() {
						watcher.dispose();
					}
				}
			}
			_ => {}
		});
}

/// External links open in the system browser, never in the app window. Everything the app
/// itself serves is allowed through.
fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
	match url.scheme() {
		"tauri" | "mdr" => true,
		"http" | "https" => {
			let host = url.host_str().unwrap_or_default();
			if matches!(host, "tauri.localhost" | "mdr.localhost" | "ipc.localhost") {
				return true;
			}
			// `tauri dev` serves `frontendDist` from its own dev server rather than the
			// `tauri.localhost` custom protocol a packaged build uses, so the app's own UI
			// arrives on a different origin. Blocking it leaves a blank window and the start-up
			// document never opens. The CLI fills `dev_url` in at run time even when the config
			// file omits it, so this matches that one exact origin — not loopback in general —
			// and only in a dev run; a shipped build never reaches it.
			if tauri::is_dev()
				&& app
					.config()
					.build
					.dev_url
					.as_ref()
					.is_some_and(|dev| dev.origin() == url.origin())
			{
				return true;
			}
			let _ = app.opener().open_url(url.as_str(), None::<&str>);
			false
		}
		_ => false,
	}
}

/// A GUI-subsystem binary has no console of its own, so a `--smoke` run borrows the launching
/// shell's to print its report.
#[cfg(windows)]
fn attach_parent_console() {
	use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
	unsafe {
		let _ = AttachConsole(ATTACH_PARENT_PROCESS);
	}
}
