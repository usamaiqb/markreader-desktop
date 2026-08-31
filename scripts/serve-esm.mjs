// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Serves the unbundled build so `stub.html` can be opened in a browser.
 *
 *  ES modules are fetched under CORS, so `file://` will not load them — the stub needs an
 *  origin. No dependency for this: it is thirty lines, and adding a dev server to the tree for
 *  a page opened by hand is not a trade worth making.
 *
 *  Run with:  npm run serve:esm     then open http://localhost:8099/stub.html
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';

const root = path.join(import.meta.dirname, '..', 'out', 'renderer-esm');
const port = Number(process.env.PORT ?? 8099);

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.map': 'application/json',
};

const server = http.createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', `http://localhost:${port}`);
	const requested = path.normalize(path.join(root, decodeURIComponent(url.pathname)));

	// The document being rendered is untrusted; so is anything that can reach this server.
	if (!requested.startsWith(root)) {
		response.writeHead(403).end('Forbidden');
		return;
	}

	try {
		const body = await fs.readFile(requested);
		response.writeHead(200, { 'Content-Type': TYPES[path.extname(requested)] ?? 'application/octet-stream' });
		response.end(body);
	} catch {
		response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
	}
});

server.listen(port, () => {
	console.log(`serving ${path.relative(process.cwd(), root)}`);
	console.log(`  http://localhost:${port}/stub.html`);
});
