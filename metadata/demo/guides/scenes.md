# Writing scenes

Scenes are TOML files. Every object names a material defined in the same file.

```toml
[camera]
position = [0.0, 1.0, 3.5]
look_at  = [0.0, 1.0, 0.0]
fov      = 40

[[material]]
name   = "white"
albedo = [0.73, 0.73, 0.73]

[[sphere]]
center   = [0.0, 0.5, 0.0]
radius   = 0.5
material = "white"
```
