// components/email.tsx: an address on a server-rendered page is never one
// unbroken string in the HTML, so no proxy that rewrites addresses (Cloudflare's
// Email Obfuscation turned them into "[email protected]" and broke hydration,
// React #418, 13 Oct 2026) can change what React hydrates against. The split
// is email-model.ts; every page was checked rendered (no address left in any
// page's text) when <Email> went in.
//
//   node --import ./tests/register.mjs --test tests/email-text.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { splitAddress, splitSentence } from "../components/email-model.ts";

test("an address splits at its last @ into the two halves the page prints around a separate @", () => {
  assert.deepEqual(splitAddress("ana.b+ci@acme.example.com"), ["ana.b+ci", "acme.example.com"]);
  assert.deepEqual(splitAddress('"odd@local"@x.io'), ['"odd@local"', "x.io"]);
});

test("not an address: no split, the text is shown as it is", () => {
  for (const v of ["key:ci", "", null, undefined, "@x.io", "ana@"]) assert.equal(splitAddress(v), null, String(v));
});

test("a sentence: words kept, addresses at the odd places, joined back it is the same text", () => {
  const parts = splitSentence("Created 4 Oct by ana@acme.io, then bo@x.co");
  assert.deepEqual(parts.filter((_, i) => i % 2), ["ana@acme.io", "bo@x.co"]);
  assert.equal(parts.join(""), "Created 4 Oct by ana@acme.io, then bo@x.co");
  assert.deepEqual(splitSentence("key:ci-deploy"), ["key:ci-deploy"]);
});

test("the component prints the @ in its own element", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "components", "email.tsx"), "utf8");
  assert.match(src, /\{parts\[0\]\}\s*<span>@<\/span>\s*\{parts\[1\]\}/);
});
