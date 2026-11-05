# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com) and this project
adheres to [Semantic Versioning](https://semver.org).

## [0.2.0] - 2026-11-05

### Added
- Tabs: open several documents in one window. Clicking a file in the sidebar or following a
  link opens a preview tab (shown in italics) that the next one replaces; double-click a tab
  to pin it. Tabs with the same file name show their folder.
- Tab shortcuts: Ctrl+W closes the tab, Ctrl+Shift+T reopens the last closed one, Ctrl+Tab
  switches by most recent use, Ctrl+PgUp/PgDn move left and right, and Ctrl+1–9 jump to a
  tab. Middle-click closes a tab, and Ctrl+click or middle-click on a link opens it in a
  background tab. On macOS, Cmd+W closes a tab and Close Window moves to Cmd+Shift+W.
- Each tab keeps its own scroll position.
- Open several files at once from the command line, the Open dialog, or drag and drop. A
  second launch hands all of its files to the window already open.
- The tabs from the last session are reopened on launch: their order, pinned state, scroll
  positions and the active tab. Files deleted since then are skipped without an error. Set
  `"restoreSession": false` in `settings.json` to turn this off.

### Changed
- Documents opened from the sidebar or a link now also appear in the system's recent
  documents list.

### Fixed
- A mermaid diagram that fails to parse no longer leaves mermaid's "Syntax error in text"
  graphic in the document.

## [0.1.0] - 2026-10-13

### Added
- MarkReader, a standalone Markdown reader built from VS Code's Markdown preview
- Markdown rendering with syntax highlighting (55 languages), math (KaTeX), and diagram support (mermaid)
- Encoding detection on read: UTF-8, UTF-8 with a BOM, and UTF-16 with or without one
- Open documents from inside the app, drag-and-drop, the command line, or by double-clicking a `.md` file
- Folder browsing with a Markdown file sidebar
- File watching with live reload
- Settings persisted to `settings.json` in the platform config directory, hand-editable and the only way to set `fontSize`, `lineHeight`, `fontFamily` and the KaTeX `mathMacros` table
- Cross-platform shell (Tauri) with installers for Windows (NSIS) and Linux (deb, AppImage)
