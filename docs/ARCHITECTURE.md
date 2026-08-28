# Architecture

MarkReader is a standalone desktop Markdown reader. The rendering core is extracted from
VS Code's Markdown preview (`extensions/markdown-language-features`) and cut loose from the
`vscode` API; the shell is [Tauri](https://tauri.app) — a Rust backend plus the OS webview.

## File layout

```
src-tauri/               the backend (Rust)
  src/
    main.rs              window, app wiring, single instance, external links
    commands.rs          the commands the frontend calls (dialogs, open, reveal, theme)
    document.rs          reading a document, pushing it to the frontend, folder scans
    protocol.rs          the mdr:// scheme, served from disk
    watcher.rs           watches the document's directory for saves (notify)
    tree.rs              collects markdown files for the sidebar
    menu.rs              application menu; view state lives in the renderer
    settings.rs          settings.json: read at start-up, written on every change
    recent.rs            Windows recent-documents list
    cli.rs               argv parsing: `markreader notes.md`
    smoke.rs             the --smoke test hook
  tauri.conf.json        window, bundle and file-association config
  capabilities/          what the window is allowed to call

src/
  bridge/                the frontend half of the bridge
    bridge.ts            installs window.markreader on top of invoke()/listen()
    entry.ts             bridge, then renderer — bundled to out/renderer/renderer.js
  renderer/              the document view (browser, no backend access)
    engine.ts            ← markdownEngine.ts, de-vscoded
    slugify.ts           ← slugify.ts, verbatim
    frontMatter.ts       ← yamlPreamble.ts, de-vscoded
    plugins.ts           ← markdown-math, plus a task-list plugin
    highlight.ts         highlight.js core + the explicit list of languages that ship
    renderer.ts          app logic: links, outline, find, theming, mermaid
    config.ts            replaces MarkdownPreviewConfiguration
    paths.ts             browser-safe path helpers
    util.ts              escaping + mdr:// URI helpers
    index.html           replaces MdDocumentRenderer.renderDocument()
    css/
      markdown.css       ← VS Code, verbatim
      highlight.css      ← VS Code, verbatim
      theme.css          the --vscode-* variable shim
      app.css            application chrome
```

The renderer never talks to the backend directly. It calls `window.markreader`, which
`src/bridge/bridge.ts` implements with `invoke()` and `listen()` — one method per command, and
the event channel names (`document:opened`, `document:changed`, `folder:opened`,
`command:*`) are the same strings the backend emits.

## What was cut from the VS Code original

`markdownEngine.ts` had five couplings to the extension host. Each was replaced:

| VS Code dependency | Replacement |
| --- | --- |
| `vscode.Uri` | Plain absolute path strings |
| `MarkdownPreviewConfiguration.getForResource()` | `config.ts` |
| `vscode.env.uriScheme`, `vscode:` link normalization | Removed |
| `vscode.workspace.getWorkspaceFolder()` | `RenderContext.rootPath` |
| `MarkdownContributionProvider` | A plain array of markdown-it plugins |

Dropped wholesale, because they only mean something inside the editor:
`preview.ts`, `previewManager.ts`, `markdownEditorProvider.ts` (webview panel lifecycle and
editor↔preview scroll sync), `preview-src/index.ts` (built on `acquireVsCodeApi()`),
`security.ts` (webview CSP trust levels), and `lineDiff.ts` / `renderedDiffWarning.ts`
(the diff-preview feature).

`documentRenderer.ts` shrank to `index.html`: most of it was CSP nonces and
`asWebviewUri()` rewriting. The `.markdown-body` wrapper it emitted is kept, because
`markdown.css` targets it.

## Deviations from the original migration plan

- `tauri-plugin-opener` instead of `tauri-plugin-shell` — it has `reveal_item_in_dir`, the
  `showItemInFolder` equivalent.
- `RunEvent::Opened` instead of `tauri-plugin-deep-link` for the macOS open-file case —
  deep-link handles URL schemes, not file associations.
- An in-app `--smoke` harness instead of `tauri-driver` for the tests — which also means the
  suite writes no screenshots, since the webview cannot capture its own window.

## The `mdr://` protocol

VS Code rewrites local image and link references to webview URIs via
`resourceProvider.asWebviewUri()`. MarkReader rewrites them to a custom `mdr://` scheme that
`src-tauri/src/protocol.rs` serves from disk.

The alternative — loading the page over `file://` and setting `<base href>` to the
document's folder — would also redirect the app shell's own relative asset paths, so the
custom scheme is used instead.

WebView2 supports no non-standard schemes, so on Windows the runtime maps
`mdr://localhost/<path>` onto `http://mdr.localhost/<path>` and intercepts that instead;
`asLocalResourceUri()` in `util.ts` emits whichever form the platform needs, and the Rust
handler accepts both. This is also why the page's CSP lists `http://mdr.localhost`.

Because this is a local reader, the protocol handler will serve any file the user can read.
If you want it locked to the opened folder, add a prefix check in `file_path()` in
`src-tauri/src/protocol.rs`.

## Settings

Settings live in `settings.json` in the platform config directory: `%APPDATA%/com.markreader.app`
on Windows, `~/.config/com.markreader.app` on Linux, and
`~/Library/Application Support/com.markreader.app` on macOS. It is written on every change and
is meant to be hand-editable — `fontSize`, `lineHeight`, `fontFamily` and the KaTeX
`mathMacros` table have no menu item and can only be set there.

The renderer still owns the shape of the configuration, and still does not know where it ends up:

- `src-tauri/src/settings.rs` reads the file at start-up and hands the JSON to the webview as an
  initialization script, which runs before any page script. That is what lets the renderer apply
  the stored theme on its first paint; an `invoke()` would mean painting the default theme and
  correcting it a round-trip later, visibly, on every launch.
- `bridge.ts` takes that global off `window` and exposes it as `api.settings`, alongside
  `api.saveSettings()`.
- `config.ts` validates it. `parseConfig()` has one validator per setting and drops anything it
  does not recognize or cannot use, so a hand-edited or stale file costs only the entries that
  are actually wrong. `onConfigChanged()` is the hook the host saves from — nothing else in the
  renderer uses it.

An unreadable or malformed file reads as "nothing stored", never as an error. Writes go through
a temp file and a rename, so a crash part-way through one cannot leave a truncated file behind
for the next launch to read.

A `--smoke` run is redirected to a settings file in the suite's scratch directory (`test/tmp`),
which the runner wipes first. The suite therefore exercises the real load and save path without
reading, or overwriting, the developer's own settings.

## Theming

`markdown.css` and `highlight.css` are unmodified, so they expect the `--vscode-*` custom
properties the workbench injects, plus a `vscode-light` / `vscode-dark` class on the body.
`theme.css` supplies both, with values from Default Dark Modern and Default Light Modern.
`highlight.css` already ships light overrides under a `.vscode-light` prefix, so code
highlighting switches themes for free.

The renderer owns the theme decision and tells the backend which colour to paint the window
with (`set_window_background`), so resizing never flashes white behind the page.

## Deliberate differences from VS Code

- **Task lists render as checkboxes.** VS Code's preview has no task-list plugin, so it shows
  the literal text `[x]`. That reads as broken in a standalone reader, so `plugins.ts` adds
  one. This is the only rendering behaviour that intentionally diverges.
- **Outline, find bar, file sidebar, and code-block copy buttons** are additions; VS Code gets
  those from the surrounding workbench.
- **No editor scroll sync**, no preview security levels, no diff preview.

## Known limitations

- `markdown.css` still contains the diff-preview rules, since it's copied verbatim. They never
  match, because no diff markup is emitted. Kept unmodified so the file stays diffable against
  upstream.
- Bundle size is dominated by `mermaid`, which is already a lazy chunk. `highlight.js` used to
  share that distinction; `highlight.ts` registers an explicit list of 55 languages on the core
  instead of importing all ~190, which is half the eagerly-loaded bundle. Adding a language
  means adding a line there.
- The tests take no screenshots. The webview cannot capture its own window, so visual review
  means running the app and using the OS screenshot tool.

## Notes on the build

- **The two frontend builds are wired into Tauri, not run by hand.** `tauri.conf.json` sets
  `beforeDevCommand: "npm run build"` (dev, with sourcemaps) and
  `beforeBuildCommand: "npm run build:prod"` (minified). So `npm start`/`tauri dev` compiles
  the frontend for you, and every `tauri build` — including `package:dir` and the CI/release
  installers — silently produces the minified bundle first. Only run `npm run build` manually
  if you want the dev output outside of Tauri's lifecycle.
- **Frontend dependencies live in `devDependencies`.** esbuild inlines markdown-it, KaTeX,
  mermaid and highlight.js into `out/renderer`, which `tauri build` then embeds in the binary;
  nothing is needed at runtime.
- **The executable is unsigned.** Windows SmartScreen will show an "unrecognized app" warning
  on first run — *More info* → *Run anyway*. Removing that needs a paid code-signing
  certificate; set `bundle.windows.certificateThumbprint` once you have one.
- **The icon** comes from `build/icon.svg`: `npm run icon` rasterizes it into the whole
  `src-tauri/icons/` set, including the `.ico` the installer and window use.
- **Smart App Control**, if enforced, refuses to run build scripts or load proc-macro DLLs
  written under `%USERPROFILE%\Documents`, and cargo fails with *"An Application Control policy
  has blocked this file"* (CodeIntegrity event 3033 / os error 4551). The workaround is a local
  `src-tauri/.cargo/config.toml` with `[build] target-dir` pointing outside that folder. See
  `KNOWN_ISSUES.md` §2. The test scripts never hardcode the target path: `verify-packaged.mjs`
  and the `markreader` npm bin shim resolve it via `cargo metadata`.
