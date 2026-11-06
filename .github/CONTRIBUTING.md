# Contributing

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Read [ARCHITECTURE.md](../docs/ARCHITECTURE.md)
before you change the renderer.

## Setup

Install:

- Node.js 22.22+ or 24+ (CI uses 24)
- The Rust toolchain (`rustup`)
- Windows: the MSVC build tools and the WebView2 runtime. `npx tauri info` checks them.
- Linux: the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/), and
  `xvfb` for headless tests

```bash
npm install
npm start                                  # builds the frontend and runs the app
npm start -- -- -- ../samples/kitchen-sink.md   # opens a file (paths resolve from src-tauri/)
npm run watch                              # rebuilds the frontend on change
```

Close any running MarkReader first. A second launch sends its file to the open window.

To open files from a terminal, run `npm link` once, then `markreader notes.md`.

If cargo fails with *"An Application Control policy has blocked this file"*, see
[KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md#smart-app-control-blocks-cargo-builds-under-the-user-profile).

## Checks

Run these before you open a PR:

```bash
npm run typecheck
npm run lint
npm run test:unit                          # renderer unit tests, no webview
npm test                                   # builds, then runs the in-app smoke suite
npm run check:version
```

Also run these when you change:

| Change | Command | Notes |
| --- | --- | --- |
| `src/renderer/` | `npm run build:esm && npm run verify:esm` | CI does not run this. To see the stub host, run `npm run serve:esm` and open `http://localhost:8099/stub.html` |
| The backend or packaging | `npm run package:dir && npm run verify:packaged` | Runs the suite against a release binary |
| Visible UI | `npm run screenshots` | Windows only. Updates `metadata/screenshots/`. Do not touch the window while it runs |
| `build/icon.svg` | `npm run icon` | Regenerates `src-tauri/icons/` |

## Writing docs and comments

Keep docs few and short.

- Put a fact next to the code it describes, in that file's comment. Use a doc only for facts
  that span files.
- Write each fact once. Link to it from other places.
- Say what the code does and why. Do not write history, changing numbers or line numbers.
- When you change code, update or delete the text that describes it.
- Use short sentences, the active voice, and one term for one thing
  ([ASD-STE100](https://www.asd-ste100.org) writing rules).
- Write steps as commands. Use lists and tables, not long paragraphs.

| Content | Place |
| --- | --- |
| How the parts fit together | `docs/ARCHITECTURE.md` |
| A platform problem: symptom, cause, fix | `docs/KNOWN_ISSUES.md` |
| A procedure | `.github/CONTRIBUTING.md` |
| Rules for coding agents | `AGENTS.md` |

## Pull requests

PR titles use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
`docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`, `revert:`, `style:`). The
title becomes the squashed commit on `main`, and its type sets the release-note label.

## CI

`.github/workflows/ci.yml` runs on every PR and every push to `main`. A push to `main` runs
everything. The `Detect changes` job decides what a PR runs:

| PR changes | CI runs |
| --- | --- |
| Docs only | Nothing |
| Code | Static checks, and the smoke suite on Windows, Linux and macOS |
| Packaging inputs | The above, and the installers |

When you add a file that changes the package, add it to the patterns in `Detect changes`.

`main` requires two checks: `Test, lint & build` and `Conventional Commit title`. If you rename
either one, update the branch ruleset.

## Release

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. It checks the versions, re-tests,
builds the Windows and Linux installers, and creates a GitHub Release. The release notes come
from PR labels, so `CHANGELOG.md` is the only release text you write.

```bash
# 1. Branch from an up-to-date main
git checkout main && git pull origin main
git checkout -b release/v0.1.1

# 2. Set "version" in package.json, then copy it to the other files
npm run check:version -- --fix
(cd src-tauri && cargo update -p markreader)   # --fix cannot update Cargo.lock
npm run check:version                          # must print "All versions match"

# 3. Add the version to the top of CHANGELOG.md, and add
#    <release version="0.1.1" date="YYYY-MM-DD"/> first inside <releases> in
#    metadata/com.markreader.desktop.metainfo.xml

# 4. Commit the release files and open a PR titled "chore(release): v0.1.1"
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json CHANGELOG.md metadata/com.markreader.desktop.metainfo.xml
git commit -m "chore(release): v0.1.1"
git push -u origin release/v0.1.1

# 5. After the PR merges, tag main
git checkout main && git pull origin main
npm run check:version
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin v0.1.1
```
