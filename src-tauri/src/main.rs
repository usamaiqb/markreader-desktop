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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// The one window there is today. Per-document state is already keyed by window label (see
/// `WindowState`); this constant is what still assumes there is only one.
pub const WINDOW_LABEL: &str = "main";

/// Painted behind the page so resizing never flashes white. The renderer keeps it in step
/// with the theme through `set_window_background`.
const BACKGROUND: Color = Color(0x1f, 0x1f, 0x1f, 0xff);

/// How long to wait for the frontend to report in before showing the window regardless.
const READY_FALLBACK: Duration = Duration::from_secs(2);

/// Everything the commands, the menu and the watcher need to reach.
pub struct AppState {
	/// Per-window document state, keyed by webview window label. An entry is created the first
	/// time a window opens a document or folder; a window without one has nothing to watch and
	/// nothing the `mdr://` scheme will serve it.
	pub windows: Mutex<HashMap<String, WindowState>>,
	pub zoom: Mutex<f64>,
	/// Documents asked for before the frontend had listeners attached — the command line, or
	/// a file the OS hands over at launch — held until it has. See `document::open_when_ready`.
	pub pending_files: Mutex<Vec<PathBuf>>,
	/// Set by `frontend_ready`. Until then a `document:opened` would reach nobody.
	pub frontend_ready: AtomicBool,
	pub window_shown: AtomicBool,
	pub smoke: Option<smoke::Smoke>,
}

/// What one window has open. Held per window rather than app-wide so a second window — or a
/// second tab's worth of documents — never widens what another window's page may read.
#[derive(Default)]
pub struct WindowState {
	/// Live reload for every document open in the window.
	pub watcher: watcher::FileWatcher,
	/// Which directories the `mdr://` scheme will serve this window from. See
	/// `protocol::ResourceRoots`.
	pub roots: protocol::ResourceRoots,
}

fn main() {
	let exit_code = run();
	std::process::exit(exit_code);
}

fn run() -> i32 {
	let cli = cli::from_env();

	#[cfg(windows)]
	if cli.smoke_script.is_some() {
		attach_parent_console();
	}

	let state = AppState {
		windows: Mutex::new(HashMap::new()),
		zoom: Mutex::new(1.0),
		pending_files: Mutex::new(cli.files.clone()),
		frontend_ready: AtomicBool::new(false),
		window_shown: AtomicBool::new(false),
		smoke: cli
			.smoke_script
			.clone()
			.map(|script| smoke::Smoke::new(script, cli.smoke_out.clone())),
	};

	let exit_code = Arc::new(AtomicI32::new(0));
	let requested = exit_code.clone();

	let loop_code = tauri::Builder::default()
		// Replaces `requestSingleInstanceLock` + the `second-instance` event: a second launch
		// hands its arguments over and exits.
		.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
			if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
				if window.is_minimized().unwrap_or(false) {
					let _ = window.unminimize();
				}
				let _ = window.set_focus();
			}
			document::open_when_ready(app, WINDOW_LABEL, cli::parse(argv.into_iter().skip(1)).files);
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
			commands::note_recent_document,
			commands::sync_documents,
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
					// The one left showing, which is the last opened.
					cli.files.last().map(PathBuf::as_path),
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
		.run_return(move |app, event| match event {
			// The code given to `AppHandle::exit` reaches this event but never the process:
			// tauri-runtime-wry answers RequestExit with `ControlFlow::Exit`, which is
			// `ExitWithCode(0)`, so `run_return` yields 0 however the app was asked to quit.
			// A failing `--smoke` run therefore looked like a passing one. Catch the code on
			// its way past and let `main` apply it. `code` is None for an ordinary quit.
			tauri::RunEvent::ExitRequested { code: Some(code), .. } => {
				requested.store(code, Ordering::SeqCst);
			}
			// macOS: double-clicking a .md in Finder.
			#[cfg(target_os = "macos")]
			// At launch this can arrive before the page is listening, hence `open_when_ready`.
			tauri::RunEvent::Opened { urls } => {
				let files = urls
					.iter()
					.filter_map(|url| url.to_file_path().ok())
					.filter(|path| path.is_file())
					.collect();
				document::open_when_ready(app, WINDOW_LABEL, files);
			}
			tauri::RunEvent::Exit => {
				if let Some(state) = app.try_state::<AppState>() {
					if let Ok(mut windows) = state.windows.lock() {
						for window in windows.values_mut() {
							window.watcher.dispose();
						}
					}
				}
			}
			_ => {}
		});

	// An ordinary quit leaves the cell at its default and the loop's own code stands.
	match exit_code.load(Ordering::SeqCst) {
		0 => loop_code,
		code => code,
	}
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
