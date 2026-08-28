# Contributing

Thanks for wanting to help with MarkReader. This project follows standard open-source
practices: Conventional Commits, PR-based contributions, and a release pipeline in CI.

## Setup

Prerequisites:

- Node.js 20+ (with npm)
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
| `scripts/` | Version-check script |

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Development workflow

- **Frontend** — `npm run build` (dev, with sourcemaps) or `npm run watch` for rebuild-on-change.
- **Backend** — lives in `src-tauri/`; `npm start` rebuilds and runs it.
- **Open a document in a dev run** — pass an absolute path to the binary directly, since a
  relative path through `tauri dev` doesn't resolve (see
  [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)):

  ```bash
  cd src-tauri && cargo run -- C:\docs\spec.md
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
- `npm test` builds the frontend first, then runs the in-app smoke suite (43 assertions
  covering front matter, slugs, highlighting, math, mermaid, image loading, outline, find,
  theming, the folder sidebar, and live reload).
- `npm run verify:packaged` re-runs the whole suite against a release binary — do this after
  `npm run package:dir` if your change touches packaging or the backend.

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
2. Re-tests the tagged commit, builds all three installers, and uploads them.
3. Creates a GitHub Release with auto-generated notes grouped by label.

To cut a release:

```bash
# 1. Bump the version everywhere (package.json is the source of truth)
npm run check:version -- --fix

# 2. Regenerate Cargo.lock if Cargo.toml changed
cd src-tauri && cargo build

# 3. Verify
npm run check:version

# 4. Update CHANGELOG.md with the new version's entry

# 5. Commit, tag, push
git add -A && git commit -m "chore: release v0.1.1"
git tag v0.1.1 && git push origin main --tags
```

> Note: there is no separate `versionCode` to bump — this is not an Android project — so the
> version-sync check takes that role.
