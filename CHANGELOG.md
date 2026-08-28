# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com) and this project
adheres to [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-08-23

### Added
- Initial release of MarkReader, a standalone Markdown reader built from VS Code's Markdown preview
- Markdown rendering with syntax highlighting (55 languages), math (KaTeX), and diagram support (mermaid)
- Encoding detection on read: UTF-8, UTF-8 with a BOM, and UTF-16 with or without one
- Open documents from inside the app, drag-and-drop, the command line, or by double-clicking a `.md` file
- Folder browsing with a Markdown file sidebar
- File watching with live reload
- Settings persisted to `settings.json` in the platform config directory, hand-editable and the only way to set `fontSize`, `lineHeight`, `fontFamily` and the KaTeX `mathMacros` table
- Cross-platform shell (Tauri) with installers for Windows (NSIS), Linux (deb, AppImage), and macOS (dmg)
