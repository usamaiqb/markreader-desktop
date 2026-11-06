# Known issues

## Smart App Control blocks cargo builds under the user profile

**Symptom:** on Windows with Smart App Control (SAC) enforced, cargo fails with *"An
Application Control policy has blocked this file. (os error 4551)"* (CodeIntegrity event 3033).
It fails on a build-script `.exe` or proc-macro `.dll` under `target/debug/`.

**Cause:** SAC trusts a file less when it is created in `Documents`, `Downloads` or `Desktop`.
An unsigned binary there looks like a download, so SAC blocks it. Cargo writes unsigned build
artifacts to `target/`, so a project in one of those folders is blocked.

**Fix:** move the target directory out of those folders. Create `src-tauri/.cargo/config.toml`
(git ignores it):

```toml
[build]
target-dir = "C:/Users/<you>/AppData/Local/cargo-target"
```

The project scripts (`bin/markreader.js`, `test/verify-packaged.mjs`) get the target directory
from `cargo metadata`, so they work with this change. A new script that finds build output must
do the same.
