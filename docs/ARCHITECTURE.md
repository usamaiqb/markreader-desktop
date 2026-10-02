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
    host.ts              the host contract, and the path space contract with it
    document.ts          DocumentView: links, find, outline, theming, mermaid — shareable
    mermaid/             ← mermaid-markdown-features vsCodeTheme.ts and its two imports, verbatim
    shell.ts             desktop chrome: file list, outline pane, find bar, menus
    renderer.ts          composition root: introduces the two
    sanitizer.ts         the only place document HTML enters the DOM
    lazy.ts              what a document needs (KaTeX, highlight.js) and loading only that
    config.ts            replaces MarkdownPreviewConfiguration
    paths.ts             browser-safe path helpers
    util.ts              mdr:// URI helpers
    markdown-language-features/util/dom.ts  ← dom.ts, verbatim: the escaping helpers
    vscode.ts            the `vscode` module, as far as the verbatim files use it
    index.html           replaces MdDocumentRenderer.renderDocument()
    css/
      markdown.css       ← VS Code, verbatim
      highlight.css      ← VS Code, verbatim
      theme.css          the --vscode-* variable shim
      document-overrides.css  every local deviation from the two verbatim files, plus the
                              document's own rules — RTL, mobile, mermaid, KaTeX, anchors,
                              find highlights
      app.css            application chrome (desktop only)
```

`renderer/` is split so that a second host can load only part of it. `document.ts` owns
everything inside the reading surface and touches no DOM outside its root; `shell.ts` owns the
chrome and never reaches into the document. They meet through five events and the
`DocumentHost` interface, so a second host can take the first and supply its own second. A
prospective Android app is the candidate for that; nothing here depends on it yet.

Paths crossing that interface are **opaque to the renderer** — it does string maths on them
and hands the result back, so a host is free to make a path mean whatever it likes. The
contract is stated in full at the top of `renderer/host.ts` and enforced by
`test/unit/opaque-paths.test.ts`, which runs the same cases over a POSIX path, a Windows path
and an Android `/saf/<token>/…` virtual path.

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

The handler serves only from `ResourceRoots`: the directory of the open document, and the
opened folder when there is one. Both are canonicalized, so neither a `..` segment nor a
symlink reaches outside them, and anything else gets a 404 — the same answer as a file that
does not exist, so a document cannot probe for what is there.

It used to serve any file the user could read, which was a defensible trade for a local reader
and is not one any more: the page renders untrusted document HTML, and `img-src` has to allow
`https:` for documents that legitimately reference remote images. Those two together are a
read-anything-and-beacon-it-out channel. This is the same scoping VS Code applies with
`localResourceRoots` on the webview the preview came from.

The visible cost: a document that references an image *above* its own folder, with no folder
open, no longer loads it. Open the containing folder and it works.

## Security

The page executes untrusted content — `markdown-it` runs with `html: true`, because a Markdown
reader that drops raw HTML is not much of one. Four layers, none of which is sufficient alone:

| Layer | Where | Stops |
| --- | --- | --- |
| CSP | `tauri.conf.json` (header) and `index.html` (meta) | Inline handlers and injected scripts — `script-src 'self'` with no `'unsafe-inline'` |
| Sanitizer | `renderer/sanitizer.ts`, the only place document HTML enters the DOM | Scripts, frames, forms, document stylesheets, `javascript:` URLs |
| Resource roots | `protocol.rs` | Reads outside the open document's folder |
| Scheme allowlist | `commands.rs`, `is_openable_external` | Handing anything but `http`/`https`/`mailto` to the OS |

Two notes for anyone changing this. The sanitizer drops any attribute whose value contains
`-->` (DOMPurify's mXSS defence, no opt-out) — which is why the mermaid diagram source travels
as element text rather than an attribute. And `style` attributes stay allowed, because KaTeX
lays out its output with them; `<style>` elements do not.

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
- **Nothing heavy is loaded until a document needs it.** mermaid, highlight.js and KaTeX are
  all lazy chunks, and KaTeX's 1.4MB stylesheet is injected on demand rather than linked in
  the page. `lazy.ts` decides from the document text, *before* the render, so a document is
  painted once and complete instead of reflowing as modules arrive. That took the entry bundle
  from 1.6MB to 598KB.

  Detection deliberately errs towards loading: any `$` counts as math. A module loaded
  needlessly renders exactly as before, whereas a missed one renders `$x^2$` as text.
- `highlight.ts` registers an explicit list of 55 languages on the highlight.js core instead of
  importing all ~190. Adding a language means adding a line there.
- The tests take no screenshots. The webview cannot capture its own window, so visual review
  means running the app and using the OS screenshot tool.

## The unbundled build

`npm run build` produces the bundle Tauri ships. `npm run build:esm` produces the artifact a
non-Tauri host such as an Android WebView would load: **our code as plain ES modules, libraries
as vendored single files.** The point of having both is that they are the same source — "works
bundled, breaks unbundled" is a whole class of bug, and it is one we would otherwise meet on a
device.

```
out/renderer-esm/
  document.js  engine.js  shell.js  …   13 modules, 92kb, unminified, 1:1 with the source
  vendor/                               6 libraries, minified, self-contained
  css/                                  the document stylesheets, plus katex.css
  stub.html  stub.js  samples/          the stub host and something for it to render
```

`scripts/build-esm.mjs` does three things: `tsc` emits our code one file in, one file out; each
library is prebuilt into one ESM file; then a rewrite pass points every import at a real file —
adding the `.js` extension `tsc` omits, and swapping bare specifiers for vendored paths. Source
keeps the upstream specifier, so the ported VS Code files stay diffable.

Libraries are *built*, not copied, because almost none ship something a browser loads directly:
`@vscode/markdown-it-katex` is CommonJS only, and `highlight.js`'s `es/` entry points re-export
its CommonJS. Two traps worth knowing:

- Building the KaTeX plugin with `katex` marked external leaves a `__require("katex")` shim
  whose body throws. It builds clean and fails at the first document with math. KaTeX has to be
  baked in, which is why that file is 269kb.
- Flattening mermaid loses its internal lazy loading of diagram types. Acceptable here because
  the whole of mermaid is already behind one dynamic `import()`, but it is why it is 3.4MB
  rather than the 2.7MB budgeted for it.

`npm run verify:esm` checks the result: every import resolves, no bare specifiers survive, no
throwing shims, and — under jsdom — the modules actually execute and render a document.

`npm run serve:esm` then `http://localhost:8099/stub.html` opens the stub host: a bare page
with no `app.css` and no `shell.ts`. If the document module renders there it will render in a
WebView, because that page gives it strictly less than one. It is also the regression test for
shell coupling — the moment `document.ts` reaches for an element only the desktop chrome has,
the stub breaks and the app does not.

**A stylesheet can couple the same way, and the stub will not tell you.** A rule for something
`document.ts` draws, left in `app.css`, renders on desktop and silently does not on a host that
loads only the document stylesheets — the find highlights were exactly that, and a custom
highlight with no `::highlight()` rule for its name paints nothing and throws nothing. There is
no visual assertion to catch it, so `vendored-files.test.ts` checks the one case that fails
invisibly: every name passed to `CSS.highlights.set()` has a rule in a document stylesheet.

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
