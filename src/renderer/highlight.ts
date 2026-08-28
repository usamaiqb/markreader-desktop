// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  highlight.js, registered language by language.
 *
 *  VS Code's preview imports the default `highlight.js` entry point, which pulls in all ~190
 *  bundled grammars. Most of them are for languages nobody puts in a Markdown fence, and they
 *  dominate the bundle. The core plus this list keeps the ones people actually write.
 *
 *  Aliases come for free with the language that owns them, which is why several names the
 *  engine never registers still resolve: `sh`/`zsh` from `bash`, `html`/`svg` from `xml`,
 *  `js`/`jsx`/`mjs` from `javascript`, `ts` from `typescript`, `toml` from `ini`, `md` from
 *  `markdown`, `yml` from `yaml`, `cs`/`c#` from `csharp`, `docker` from `dockerfile`,
 *  `bat`/`cmd` from `dos`, `tex` from `latex`, `py` from `python`, `text`/`txt` from
 *  `plaintext`. `normalizeHighlightLang()` in engine.ts maps the handful of names VS Code
 *  special-cased on top of that.
 *
 *  A fence in a language that is not here is not broken — the engine escapes the body and
 *  renders it unhighlighted, exactly as it does for an unknown language today. So this list is
 *  a shipping decision, not a correctness one: to add a language, add the import and the entry.
 *--------------------------------------------------------------------------------------------*/

import hljs from 'highlight.js/lib/core';

import apache from 'highlight.js/lib/languages/apache';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import fsharp from 'highlight.js/lib/languages/fsharp';
import go from 'highlight.js/lib/languages/go';
import gradle from 'highlight.js/lib/languages/gradle';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import http from 'highlight.js/lib/languages/http';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import nginx from 'highlight.js/lib/languages/nginx';
import nix from 'highlight.js/lib/languages/nix';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import properties from 'highlight.js/lib/languages/properties';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import vbnet from 'highlight.js/lib/languages/vbnet';
import wasm from 'highlight.js/lib/languages/wasm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/** The languages that ship. Keys are the canonical highlight.js names. */
const languages = {
	apache,
	bash,
	c,
	clojure,
	cmake,
	cpp,
	csharp,
	css,
	dart,
	diff,
	dockerfile,
	dos,
	elixir,
	erlang,
	fsharp,
	go,
	gradle,
	graphql,
	groovy,
	haskell,
	http,
	ini,
	java,
	javascript,
	json,
	julia,
	kotlin,
	latex,
	less,
	lua,
	makefile,
	markdown,
	matlab,
	nginx,
	nix,
	objectivec,
	perl,
	php,
	plaintext,
	powershell,
	properties,
	protobuf,
	python,
	r,
	ruby,
	rust,
	scala,
	scss,
	sql,
	swift,
	typescript,
	vbnet,
	wasm,
	xml,
	yaml,
};

for (const [name, language] of Object.entries(languages)) {
	hljs.registerLanguage(name, language);
}

/** The names registered above, for the tests and for anything that wants to report them. */
export const registeredLanguages: readonly string[] = Object.keys(languages);

export default hljs;
