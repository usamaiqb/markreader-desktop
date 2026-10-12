# Contributing

Thanks for wanting to help with MarkReader. This project follows standard open-source
practices: Conventional Commits, PR-based contributions, and a release pipeline in CI.

Taking part means following the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Prerequisites:

- Node.js 22.22+ or 24+ (with npm) — CI builds and tests on 24
- The Rust toolchain (`rustup`)
- On Windows: the MSVC build tools and the WebView2 runtime — `npx tauri info` checks all three
- On Linux: the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/)
  (WebKitGTK 4.1, etc.) and `xvfb` for headless test runs

```bash
npm install
npm start              # build the frontend, then launch the app (tauri dev)
```

## Project layout

| Path | What it is |
| --- | --- |
| `src-tauri/` | The Rust backend (window, protocol, watcher, menu) |
| `src/renderer/` | The document view (browser-side, no backend access) |
| `src/bridge/` | The `window.markreader` bridge between them |
| `test/` | The smoke test suite and its harness |
| `scripts/` | Version-check and screenshot scripts |
| `metadata/` | Store-style listing: AppStream metainfo, screenshots, and the demo docs they show |

See [ARCHITECTURE.md](../docs/ARCHITECTURE.md) for details.

## Development workflow

- **Frontend** — `npm run build` (dev, with sourcemaps) or `npm run watch` for rebuild-on-change.
- **Backend** — lives in `src-tauri/`; `npm start` rebuilds and runs it.
- **Open a document in a dev run** — pass the path after the argument separators. `tauri dev`
  runs from `src-tauri/`, so a relative path resolves from there:

  ```bash
  npm start -- -- -- ../samples/kitchen-sink.md
  ```

  A second launch hands its file to the window already open, so close any running
  `markreader` first (see [KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md)).
- **Open documents from a terminal** — `bin/markreader.js` is a cross-platform shim that
  finds a local build (or an installed copy) and passes it the file:

  ```bash
  npm link               # once, from the project root
  markreader notes.md    # relative to your current directory
  ```

## Checks before opening a PR

Run all of these locally — CI enforces the same:

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # oxlint (frontend + scripts)
npm run test:unit        # fast, headless renderer unit tests
npm test                 # launch the app and assert against the live DOM
npm run check:version    # all version files in sync
```

- `npm run test:unit` runs the renderer's pure logic (engine, slugify, paths, util) against
  vitest in Node — no webview needed.
- `npm test` builds the frontend first, then runs the in-app smoke suite (assertions
  covering front matter, slugs, highlighting, math, mermaid, image loading, outline, find,
  theming, the folder sidebar, and live reload).
- `npm run verify:packaged` re-runs the whole suite against a release binary — do this after
  `npm run package:dir` if your change touches packaging or the backend.

## Screenshots

The README and the AppStream metainfo share one set of screenshots in `metadata/screenshots/`.
Regenerate them after a visible UI change (Windows only, ~1 minute):

```bash
npm run screenshots
```

It opens `metadata/demo/` in the app, steps through the scenes in
`scripts/screenshots/scenes.js` in both themes, and captures the window for each. Close any
running MarkReader first, and leave the window alone while it runs.

## Committing

- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`,
  `revert:`, `style:`.
- The PR title becomes the squashed commit on `main` and feeds the auto-generated release
  notes, so make it descriptive.
- CI auto-labels PRs by their title type; the label drives the release-note grouping.

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`: version-sync check, then a
build+test+package matrix across Windows, Linux, and macOS. Each OS runs typecheck, lint,
the frontend unit tests, clippy, `cargo test`, the DOM smoke suite, and — after packaging —
the packaged-app verification. All actions are SHA-pinned with `permissions: contents: read`.

## Release process

Releases are tag-driven — pushing `vX.Y.Z` triggers `.github/workflows/release.yml`, which:

1. Guards: tag matches `package.json` version, all version files are in sync, tree is clean.
2. Re-tests the tagged commit, builds the Windows and Linux installers, and uploads them.
3. Creates a GitHub Release with auto-generated notes grouped by label.

To cut a release:

```bash
# 1. Bump the version everywhere (package.json is the source of truth)
npm run check:version -- --fix

# 2. Regenerate Cargo.lock if Cargo.toml changed
cd src-tauri && cargo build

# 3. Verify
npm run check:version

# 4. Update CHANGELOG.md with the new version's entry, and add a matching
#    <release> line to metadata/com.markreader.desktop.metainfo.xml

# 5. Commit, tag, push
git add -A && git commit -m "chore: release v0.1.1"
git tag v0.1.1 && git push origin main --tags
```

> Note: there is no separate `versionCode` to bump — this is not an Android project — so the
> version-sync check takes that role.
