# Known issues

## 1. `tauri dev` showed a blank window and never opened the start-up document

**Status:** fixed. Was misfiled as a relative-path bug; the path handling was never involved.

### What happened

Under `tauri dev` the app started with an empty window, the title stayed `MarkReader` instead of
`<name> — MarkReader`, and the default browser popped up asking to open a link — which, if
accepted, loaded the app's own UI in a browser tab.

### Cause

`tauri dev` does not serve the frontend over the `tauri.localhost` custom protocol a packaged
build uses. With `frontendDist` and no `devUrl`, the Tauri CLI starts its own dev server and
points the webview at `http://127.0.0.1:1430/`.

`allow_navigation` in `src-tauri/src/main.rs` allow-listed only `tauri.localhost`,
`mdr.localhost` and `ipc.localhost`. The dev-server URL matched none of them, so the app's own
UI was treated as an external link: handed to the system browser and the navigation cancelled.

Everything downstream followed from the blank page:

- the renderer never called `frontend_ready`;
- `commands::frontend_ready` is the only caller of `document::open` for the start-up file, which
  is held in `AppState::startup_file` until the frontend has listeners attached — so no document
  opened and no title was set;
- the 2s `READY_FALLBACK` showed the empty window anyway;
- a `--smoke` run hung forever, because `smoke::start` — and with it the 240s watchdog — is also
  only reached from `frontend_ready`.

### Why it looked like a relative-path bug

The failing runs used `tauri dev`; the "works" runs used `cd src-tauri && cargo run`, which has
no dev server and so loads over `tauri.localhost` normally. Absolute vs relative tracked that
split by coincidence. Verified: an **absolute** path under `tauri dev` failed identically
(title stayed `MarkReader`), and a relative path under `cargo run` worked.

For the record, `tauri dev` leaves the working directory at `src-tauri/`, so
`../samples/kitchen-sink.md` resolved correctly the whole time.

### Fix

`allow_navigation` also accepts the dev server's own origin. The Tauri CLI fills `dev_url` in at
run time even though `tauri.conf.json` omits it, so this matches that one exact origin rather
than loopback in general, and only during a dev run — a shipped build never reaches the branch:

```rust
if tauri::is_dev()
    && app.config().build.dev_url.as_ref()
        .is_some_and(|dev| dev.origin() == url.origin())
{
    return true;
}
```

Verified with the smoke hook — `npm start -- -- -- --smoke <script> ../samples/kitchen-sink.md`
now reports `title = "kitchen-sink.md — MarkReader"` and exits 0, and `npm test` passes all 43
assertions.

### Note for future investigations

The single-instance plugin means a second launch hands its argv to the window already open and
exits, so a leftover `markreader.exe` makes a run look like it did nothing and leaves you
inspecting the *old* process's title:

```powershell
Get-Process markreader -ErrorAction SilentlyContinue | Stop-Process -Force
```

A `--smoke` run that never reaches `frontend_ready` hangs with no output and no watchdog, so run
it redirected to a log rather than in the foreground.

---

## 2. Smart App Control blocked cargo build artifacts under the user profile

**Status:** confirmed; workaround is a local `src-tauri/.cargo/config.toml`.

### What happened

On machines where Windows enforces Smart App Control, cargo builds failed with *"An Application
Control policy has blocked this file"* — CodeIntegrity event 3033 / os error 4551, "did not
meet the Enterprise signing level requirements" — when intermediate build artifacts (build-script
`.exe`s, proc-macro `.dll`s) were written under the user's profile, in particular
`%USERPROFILE%\Documents`.

### Why moving the target directory helps

SAC's blocking is not purely signer-based; it also weighs **where** a file was created.
Folders like `Documents`, `Downloads` and `Desktop` are treated as low-trust *promoted*
locations — an unsigned binary appearing there looks like a freshly-dropped/downloaded
executable, so SAC escalates the required signing level and blocks it. Cargo writes those
artifacts to `target/debug/build` and `target/debug/deps`, so when a project sits under such a
folder they land in the flagged zone. Relocating `target-dir` to e.g. `%LOCALAPPDATA%\cargo-target`
moves them to a location where unsigned compiler output is expected, so the folder-based trust
signal no longer fires. Same unsigned DLLs, same signer, but a different origin — not blocked.

It is not the path being special; it is the path *outside the SAC-sensitive zone*.

### Verification

Removing the override and running `cargo check` reproduces the failure immediately
(`An Application Control policy has blocked this file. (os error 4551)`) on a build-script
under `target/debug/build/`, and restoring it makes the build succeed. Any project kept inside
`Documents`, `Downloads` or `Desktop` (common locations for cloned repos) needs the workaround
on an SAC-enforced machine.

### The cost and who else knows

A non-default `target-dir` means every tool must discover it rather than assume
`src-tauri/target`:
- the `markreader` npm bin shim (`bin/markreader.js`) asks `cargo metadata` for the target dir
  instead of guessing, so it finds a relocated build;
- `test/verify-packaged.mjs` does the same;
- the check `npm run check:version` reads Cargo.lock but never assumes a target path.
