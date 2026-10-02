# Third-party notices

MarkReader as a whole is licensed under the GNU General Public License v3.0 (`LICENSE`).
The files below are derived from MIT-licensed sources, so those portions remain MIT and
are reproduced here with their original notices.

## Visual Studio Code

MarkReader's Markdown engine and document stylesheets are derived from Visual Studio Code's
`markdown-language-features`, `markdown-math`, and `mermaid-markdown-features` extensions.

	Copyright (c) Microsoft Corporation. All rights reserved.
	Licensed under the MIT License.

Files derived from VS Code, and how much they changed:

| File in MarkReader | Origin in the vscode repo | State |
| --- | --- | --- |
| `src/renderer/slugify.ts` | `extensions/markdown-language-features/src/slugify.ts` | Verbatim. The two lint rules its regex trips are turned off for this file in `.oxlintrc.json` |
| `src/renderer/css/markdown.css` | `extensions/markdown-language-features/media/markdown.css` | Verbatim |
| `src/renderer/css/highlight.css` | `extensions/markdown-language-features/media/highlight.css` | Verbatim |
| `src/renderer/engine.ts` | `extensions/markdown-language-features/src/markdownEngine.ts` | Adapted — VS Code API calls replaced |
| `src/renderer/frontMatter.ts` | `extensions/markdown-language-features/src/extensions/yamlPreamble/yamlPreamble.ts` | Adapted — config and localization replaced |
| `src/renderer/plugins.ts` (math) | `extensions/markdown-math/src/extension.ts` | Adapted — settings replaced |
| `src/renderer/document.ts` | `extensions/markdown-language-features/preview-src/index.ts` | Adapted — editor scroll sync dropped; link handling, image and diagram hydration and the outline kept. This was `renderer.ts` until the document/shell split |
| `src/renderer/mermaid/vsCodeTheme.ts` | `extensions/mermaid-markdown-features/preview-src/shared/vsCodeTheme.ts` | Verbatim |
| `src/renderer/mermaid/config.ts` | `extensions/mermaid-markdown-features/preview-src/shared/config.ts` | Verbatim |
| `src/renderer/mermaid/disposable.ts` | `extensions/mermaid-markdown-features/preview-src/shared/disposable.ts` | Verbatim |
| `src/renderer/markdown-language-features/util/dom.ts` | `extensions/markdown-language-features/src/util/dom.ts` | Verbatim. Its one `vscode` import resolves to `src/renderer/vscode.ts` |

The MIT license text is reproduced in `licenses/vscode.txt`, which is where the per-file
`SPDX-FileCopyrightText: Microsoft Corporation` headers point. Files marked *Verbatim* keep
upstream's own header untouched, including its `License.txt` reference, so they stay
byte-comparable against the vscode repo.

Verbatim means verbatim, and it briefly stopped being true — in the opposite direction to the
one first suspected. 44 lines of front-matter rules were moved out of `markdown.css` as though
they were MarkReader's own additions. **They are upstream's**: VS Code ships a `yamlPreamble`
extension, and its stylesheet carries the rules for it. The move left the file 44 lines short
of the copy it exists to be. They are restored, and the three properties that genuinely deviate
— `text-align`, the list indent and the error border, made logical so RTL front matter lays out
correctly — are overrides in `src/renderer/css/document-overrides.css`, which is where every
local deviation belongs.

`test/unit/vendored-files.test.ts` pins every *Verbatim* file by hash, so the next such edit fails a
test rather than going unnoticed — though a hash only proves *unchanged since*, not *matches
upstream*. That diff was last run against `microsoft/vscode` `main` at `57b4202903e` (2026-10-02):
every *Verbatim* file is byte-identical to it.

## Bundled dependencies

Every npm package with code in the production renderer bundle, taken from esbuild's metafile
rather than from `package.json`, so packages pulled in transitively are listed too.

| Package | License |
| --- | --- |
| `markdown-it`, `linkify-it`, `mdurl`, `punycode.js`, `uc.micro` | MIT |
| `entities` | BSD-2-Clause |
| `highlight.js` | BSD-3-Clause |
| `katex`, `@vscode/markdown-it-katex` | MIT |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `yaml` | ISC |
| `@tauri-apps/api` | Apache-2.0 OR MIT |

`mermaid` (MIT) brings its own tree:

| Package | License |
| --- | --- |
| `mermaid`, `@mermaid-js/parser`, `@braintree/sanitize-url`, `@iconify/utils`, `@upsetjs/venn.js`, `cytoscape`, `cytoscape-cose-bilkent`, `cytoscape-fcose`, `cose-base`, `layout-base`, `dagre-d3-es`, `dayjs`, `es-toolkit`, `fastdom`, `khroma`, `lodash-es`, `marked`, `roughjs`, `stylis`, `ts-dedent`, `uuid` | MIT |
| `d3` and its `d3-*` modules, `internmap` | ISC |
| `d3-ease`, `d3-sankey` | BSD-3-Clause |

mermaid is held at 11, the major VS Code uses. mermaid 12 bundles `elkjs`, which is EPL-2.0
with no secondary license and so cannot be distributed as part of a GPL-3.0 work.

## Backend

The desktop shell is Tauri; the compiled binary statically links its Rust dependency tree.

| Crate | License |
| --- | --- |
| `tauri`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-single-instance` | MIT OR Apache-2.0 |
| `wry`, `tao` | MIT OR Apache-2.0 |
| `notify`, `notify-debouncer-mini` | CC0-1.0 / MIT |
| `serde`, `serde_json`, `percent-encoding`, `windows` | MIT OR Apache-2.0 |

`src-tauri/Cargo.lock` pins the full tree; `cargo tree` lists it in full.
