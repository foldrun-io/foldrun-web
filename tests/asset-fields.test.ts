// The asset drawer's Overview form writes one frontmatter key at a time
// (components/asset-fields.ts setField). A key's block is its line plus every
// line that continues it; whatever the edit, the file must stay valid YAML and
// every other key, comment and the body must be left as they were.
//
//   node --import ./tests/register.mjs --test tests/asset-fields.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { load } from "js-yaml";
const { setField, setBody, assetOpenId, editableInPlace } = await import("../components/asset-fields.ts");

const front = (doc: string) => load(doc.split("---\n")[1]) as Record<string, unknown>;

test("a list with a margin comment between its items is replaced whole", () => {
  // Codex review, 7 Nov 2026: the scan stopped at the comment and left
  // `- POST` behind, so the result no longer parsed.
  const raw = "---\nname: t\nmethods:\n- GET\n# a comment\n- POST\ndescription: d\n---\nbody\n";
  const out = setField(raw, "methods", ["PUT"]);
  assert.deepEqual(front(out), { name: "t", methods: ["PUT"], description: "d" });
  assert.ok(out.endsWith("---\nbody\n"), "the body is untouched");
});

test("a margin comment after the block, before the next key, stays", () => {
  const raw = "---\nname: t\nmethods:\n- GET\n# about description\ndescription: d\n---\n";
  const out = setField(raw, "methods", ["PUT"]);
  assert.deepEqual(front(out), { name: "t", methods: ["PUT"], description: "d" });
  assert.match(out, /# about description\ndescription: d/);
});

test("other keys, their order and their comments are left alone", () => {
  const raw = "---\n# header comment\nname: t\ncommand: npx   # inline\nargs:\n  - -y\n  - pkg\ntransport: mcp\n---\nGuide.\n";
  const out = setField(raw, "args", ["-y", "other"]);
  assert.match(out, /# header comment\nname: t\ncommand: npx {3}# inline\nargs: \[-y, other\]|args:\n/);
  assert.deepEqual(front(out).args, ["-y", "other"]);
  assert.equal(front(out).transport, "mcp");
  assert.ok(out.indexOf("command:") < out.indexOf("args:") && out.indexOf("args:") < out.indexOf("transport:"), "order kept");
});

test("an empty value removes the key; a new key is added; no frontmatter gets one", () => {
  assert.deepEqual(front(setField("---\nname: t\nurl: x\n---\n", "url", "")), { name: "t" });
  assert.deepEqual(front(setField("---\nname: t\n---\n", "url", "https://a")), { name: "t", url: "https://a" });
  assert.deepEqual(front(setField("just prose\n", "name", "n")), { name: "n" });
});

test("a quoted key, or one with space before its colon, is found and replaced", () => {
  // Codex review, 7 Nov 2026: `"description": old` was not found, so a second
  // `description:` was appended and the file no longer parsed.
  for (const spelled of ['"description": old', "'description': old", "description : old"]) {
    const out = setField(`---\nname: t\n${spelled}\n---\n`, "description", "new");
    assert.deepEqual(front(out), { name: "t", description: "new" }, spelled);
  }
  // A longer key that only starts with the name is not it.
  assert.deepEqual(front(setField("---\ndescriptions: x\n---\n", "description", "y")), { descriptions: "x", description: "y" });
});

test("frontmatter whose keys are all indented keeps its indentation", () => {
  // Codex review, 7 Nov 2026: the key was not found, an unindented duplicate
  // was appended, and the form then refused the file.
  const raw = "---\n  name: t\n  description: old\n  methods:\n  - GET\n---\nbody\n";
  const out = setField(raw, "description", "new");
  assert.deepEqual(front(out), { name: "t", description: "new", methods: ["GET"] });
  assert.match(out, /\n {2}description: new\n/);
  const added = setField(raw, "url", "https://a");
  assert.deepEqual(front(added), { name: "t", description: "old", methods: ["GET"], url: "https://a" });
  assert.deepEqual(front(setField(raw, "methods", ["PUT"])).methods, ["PUT"]);
});

test("a shared file and a workspace file with the same path open as different things", () => {
  // Codex review, 7 Nov 2026: both rows opened (and could edit or delete) the
  // shared one, because the drawer looked items up by path alone.
  const shared = assetOpenId({ path: "knowledge/foo.md", account: true });
  const own = assetOpenId({ path: "knowledge/foo.md", account: false });
  assert.notEqual(shared, own);
  assert.equal(own, "knowledge/foo.md", "a workspace file keeps the plain path, so existing links still open it");
});

test("the form edits block-style files in place and refuses styles it would break", () => {
  // Codex review, 7 Nov 2026: a flow mapping `{name: demo, description: old}`
  // read fine, but an edit appended `description: new` after it.
  assert.equal(editableInPlace("---\nname: t\ndescription: d\nargs:\n  - -y\n---\nbody\n"), true);
  assert.equal(editableInPlace("---\n  name: t\n  methods:\n  - GET\n  # c\n  - POST\n---\n"), true);
  assert.equal(editableInPlace("---\n{name: demo, description: old}\n---\n"), false);
  assert.equal(editableInPlace("---\nname: [unclosed\n---\n"), false, "unreadable YAML is Source-only too");
  assert.equal(editableInPlace("no frontmatter at all\n"), true, "a file with none gets one");
});

test("setBody replaces only the prose", () => {
  const out = setBody("---\nname: t\n---\nold\n", "new\n");
  assert.equal(out, "---\nname: t\n---\nnew\n");
});
