// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Renderer entry point. The bridge has to install `window.markreader` before the renderer
 *  module body runs, since that reads it at import time — so the order of these two imports
 *  is load-bearing. esbuild bundles this to `out/renderer/renderer.js`, which is what
 *  index.html loads.
 *--------------------------------------------------------------------------------------------*/

import './bridge';
import '../renderer/renderer';
