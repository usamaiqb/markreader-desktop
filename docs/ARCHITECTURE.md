# Architecture

MarkReader is a desktop Markdown reader. The renderer comes from VS Code's Markdown preview
(`extensions/markdown-language-features`), with the `vscode` API removed. The app shell is
[Tauri](https://tauri.app): a Rust backend and the OS webview.

This page is a map. Each file's header comment explains the details.

## File layout

```
src-tauri/src/           the backend (Rust)
  main.rs                window, app wiring, single instance, external links
  commands.rs            the commands the frontend calls
  document.rs            reads documents, tracks a window's open set, scans folders
  protocol.rs            the mdr:// scheme and its resource roots
  watcher.rs             watches open documents for saves
  tree.rs                collects Markdown files for the sidebar
  menu.rs                application menu
  settings.rs            settings.json
  session.rs             session.json: the open tabs
  recent.rs              Windows recent-documents list
  cli.rs                 argv parsing
  smoke.rs               the --smoke test hook

src/bridge/
  bridge.ts              implements window.markreader with invoke() and listen()
  entry.ts               loads the bridge, then the renderer

src/renderer/            browser only, no backend access
  host.ts                the host contract and the path contract
  document.ts            DocumentView: the shared document module
  shell.ts               the desktop shell: file list, outline, find bar, menus
  tabs/                  the tab model and tab strip (desktop only)
  renderer.ts            composition root: connects document.ts and shell.ts
  engine.ts              ← markdownEngine.ts, de-vscoded
  frontMatter.ts         ← yamlPreamble.ts, de-vscoded
  slugify.ts             ← verbatim
  mermaid/               ← vsCodeTheme.ts and its imports, verbatim
  markdown-language-features/util/dom.ts  ← verbatim
  vscode.ts              the parts of `vscode` that the verbatim files use
  plugins.ts             math and task-list plugins
  highlight.ts           highlight.js and the languages that ship
  lazy.ts                loads only the libraries a document needs
  sanitizer.ts           the only place document HTML enters the DOM
  config.ts              settings shape and validation
  paths.ts, util.ts      path and mdr:// URI helpers
  scroll.ts              the scroll container
  css/
    markdown.css         ← VS Code, verbatim
    highlight.css        ← VS Code, verbatim
    theme.css            the --vscode-* variables, from Default Dark/Light Modern
    document-overrides.css  local changes, and rules for what document.ts draws
    app.css              desktop shell only
```

**Do not edit a file marked verbatim.** It must stay diffable against upstream VS Code. Put
CSS changes in `document-overrides.css`, and code changes in the file that imports the verbatim
file.

## The shared renderer

The renderer is a shared component. This app is one host for it. Other apps are hosts too, so
a change to the document module changes every host.

- `document.ts` owns the reading surface. It touches no DOM outside its root. It reaches the
  host only through `DocumentHost` (`host.ts`).
- `shell.ts` owns the desktop chrome. It uses the document only through `DocumentView`.
- Paths are opaque to the renderer. The host decides what a path means. See `host.ts`.
- Only `src/bridge/bridge.ts` talks to Tauri. The renderer calls `window.markreader`.
- Styles for what `document.ts` draws go in the document stylesheets, not `app.css`.

## Two builds

| Command | Output | Used by |
| --- | --- | --- |
| `npm run build` | One esbuild bundle in `out/renderer/` | Tauri, which embeds it in the binary |
| `npm run build:esm` | ES modules and vendored libraries in `out/renderer-esm/` | Other hosts |

Both come from the same source, so a "works bundled, breaks unbundled" bug shows here. The
steps and traps are in `scripts/build-esm.mjs`.

Three checks guard the shared module:

- `npm run verify:esm`: the unbundled build loads and renders a document.
- The stub host (`test/stub-host.*`): the document module renders with no desktop shell.
- `vendored-files.test.ts`: styles for what `document.ts` draws are in a document stylesheet.

## Differences from VS Code

Removed, because they only work inside the editor: the webview panel lifecycle, editor scroll
sync, preview security levels and diff preview. `markdownEngine.ts` now uses plain path strings
and `config.ts` instead of `vscode.Uri` and `MarkdownPreviewConfiguration`.

Added:

- Task lists render as checkboxes. This is the only intentional rendering difference.
- Outline, find bar, file sidebar and code-block copy buttons. In VS Code, the workbench
  supplies these.

## Security

The page renders untrusted HTML (`markdown-it` with `html: true`). No layer is sufficient
alone:

| Layer | Where | Stops |
| --- | --- | --- |
| CSP | `tauri.conf.json`, `index.html` | Inline and injected scripts |
| Sanitizer | `sanitizer.ts` | Scripts, frames, forms, document stylesheets, `javascript:` URLs |
| Resource roots | `protocol.rs` | Reads outside the active document's folder and the open folder |
| Scheme allowlist | `commands.rs` | Opening anything except `http`, `https` and `mailto` |

The resource roots matter because `img-src` allows `https:`. Without them, a document could
read any local file and send it out in an image URL.

## Settings and session

The backend stores `settings.json` and `session.json` in the platform config directory. It
injects both before page scripts run, so the first paint uses the stored theme. The renderer
owns both shapes and validates them (`config.ts`, `tabs/model.ts`). Users can edit
`settings.json` by hand. Some settings, such as `fontSize` and `mathMacros`, exist only there.
