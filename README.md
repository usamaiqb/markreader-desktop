# MarkReader

A fast, standalone desktop Markdown reader. It renders Markdown exactly like VS Code's
preview — the stylesheets are the same files, carried over unchanged — with no editor required.

## Features

- **Faithful rendering** — CommonMark + GFM tables, syntax highlighting, math (KaTeX), and
  mermaid diagrams, styled by those same stylesheets
- **Open from anywhere** — file picker, drag-and-drop, terminal, or double-click a `.md` file
- **Folder browsing** — open a folder and browse its Markdown files in a sidebar
- **Live reload** — the open document re-renders on save, holding your scroll position
- **Outline, find, themes** — an outline pane with scroll spy, in-document search, and
  light/dark themes that follow your OS
- **Settings that stick** — theme, word wrap, front-matter style and the rest are saved to
  `settings.json` in your config directory
- **Small and private** — a ~5MB executable built on [Tauri](https://tauri.app), no telemetry,
  everything runs locally

## Screenshots

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="metadata/screenshots/01-main-dark.png">
    <img width="49%" alt="MarkReader showing a folder of notes, with the file sidebar on the left, a rendered document with a table and task list, and the outline on the right" src="metadata/screenshots/01-main-light.png">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="metadata/screenshots/02-rendering-dark.png">
    <img width="49%" alt="A mermaid flowchart, KaTeX equations and syntax-highlighted Rust code rendered in MarkReader" src="metadata/screenshots/02-rendering-light.png">
  </picture>
</p>

## Download

Each tagged release publishes installers for Windows and Linux on the
[Releases page](https://github.com/usamaiqb/markreader-desktop/releases):

| Platform | Format |
| --- | --- |
| Windows | `.exe` (NSIS installer) |
| Linux | `.deb` and `.AppImage` |

No version has been tagged yet, so that page is empty — until the first release,
[build from source](#building-from-source).

The Windows installer is not yet code-signed: on first launch SmartScreen warns about an
unrecognised app — choose **More info → Run anyway**.

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

Open a document from the terminal:

| Platform | Command |
| --- | --- |
| Linux (`.deb`) | `markreader notes.md` |
| Windows | `& "$env:LOCALAPPDATA\MarkReader\MarkReader.exe" notes.md` |

A second launch doesn't start a second app — it hands the file to the running window.

## Building from source

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the full developer guide.

```bash
npm install
npm start              # build the frontend, then launch the app
```

Requires the Rust toolchain, and on Windows the MSVC build tools and WebView2 runtime —
`npx tauri info` checks all three.

## Project documentation

- [CONTRIBUTING.md](.github/CONTRIBUTING.md) — setup, build, test, release process
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the app is put together
- [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) — platform-specific quirks and workarounds
- [CHANGELOG.md](CHANGELOG.md) — release history
- [SECURITY.md](.github/SECURITY.md) — how to report a vulnerability
- [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) — the standards expected of everyone taking part

## License

GPL-3.0-only. Portions are derived from Visual Studio Code, © Microsoft Corporation, which
remain under the MIT License — see `licenses/NOTICE.md` and `licenses/vscode.txt`.
