# MarkReader

A fast, standalone desktop Markdown reader. It renders Markdown exactly like VS Code's preview —
because the stylesheets *are* VS Code's stylesheets — without needing VS Code installed.

## Features

- **VS Code-faithful rendering** — CommonMark + GFM tables, syntax highlighting, math (KaTeX),
  and mermaid diagrams, styled with the real VS Code CSS
- **Open from anywhere** — file picker, drag-and-drop, terminal, or double-click a `.md` file
- **Folder browsing** — open a folder and browse its Markdown files in a sidebar
- **Live reload** — the open document re-renders on save, holding your scroll position
- **Outline, find, themes** — an outline pane with scroll spy, in-document search, and
  light/dark themes that follow your OS
- **Settings that stick** — theme, word wrap, front-matter style and the rest are saved to
  `settings.json` in your config directory
- **Small and private** — a ~5MB executable built on [Tauri](https://tauri.app), no telemetry,
  everything runs locally

## Download

Installers for Windows, Linux, and macOS are published on the
[Releases page](https://github.com/usamaiqb/markreader-desktop/releases):

| Platform | Format |
| --- | --- |
| Windows | `.exe` (NSIS installer) |
| Linux | `.deb` and `.AppImage` |
| macOS | `.dmg` |

Once installed, double-clicking any `.md` or `.markdown` file opens it in MarkReader.

## Usage

| Action | How |
| --- | --- |
| Open a file | `Ctrl+O`, **Open** button, or drag-and-drop |
| Open a folder | `Ctrl+Shift+O`, or **Folder** button |
| Toggle sidebar | `Ctrl+B` |
| Toggle outline | `Ctrl+Shift+B` |
| Find in document | `Ctrl+F` (`Enter` / `Shift+Enter` for next / previous) |
| Toggle light/dark | `Ctrl+K` |
| Reload document | `Ctrl+R` |
| Zoom | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Full screen | `F11` |

Open a document from the terminal (cross-platform, via the npm `bin` shim):

```bash
npm link               # once, from the project root
markreader notes.md    # relative to your current directory
markreader /docs/spec.md
```

A second launch doesn't start a second app — it hands the file to the running window.

## Building from source

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full developer guide.

```bash
npm install
npm start              # build the frontend, then launch the app
```

Requires the Rust toolchain, and on Windows the MSVC build tools and WebView2 runtime —
`npx tauri info` checks all three.

## Project documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, build, test, release process
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the app is put together
- [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) — platform-specific quirks and workarounds
- [CHANGELOG.md](CHANGELOG.md) — release history
- [SECURITY.md](SECURITY.md) — how to report a vulnerability

## License

GPL-3.0-only. Portions are derived from Visual Studio Code, © Microsoft Corporation, which
remain under the MIT License — see `licenses/NOTICE.md` and `licenses/vscode.txt`.
