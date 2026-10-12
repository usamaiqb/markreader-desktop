# Building

Lumen needs a recent stable Rust toolchain.

```sh
cargo build --release
./target/release/lumen scenes/cornell.toml --spp 64 -o cornell.png
```

Pass `--threads N` to limit the worker pool; it defaults to one thread per core.
