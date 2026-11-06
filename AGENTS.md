# MarkReader Desktop

Desktop Markdown reader built from VS Code's Markdown preview. Tauri (Rust) and a browser-side
renderer. GPL-3.0-only, with MIT-licensed portions derived from VS Code.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): read it before you change the renderer.
- [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md): setup, checks, release, and the rules
  for docs and comments.
- [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md): platform problems.

## Rules

- **The renderer is shared.** Other apps load `src/renderer/` too. Follow "The shared
  renderer" in ARCHITECTURE.md. After a renderer change, run
  `npm run build:esm && npm run verify:esm`. CI does not run it.
- **Do not edit files marked verbatim** in the ARCHITECTURE.md file layout, such as
  `markdown.css` and `highlight.css`.
- **Keep docs few and short.** Follow "Writing docs and comments" in CONTRIBUTING.md for every
  doc and code comment. Do not add new docs.
