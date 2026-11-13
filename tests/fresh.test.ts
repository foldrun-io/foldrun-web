// Read-your-writes (server/fresh.ts): what a request brings level with the
// heads before it is answered (14 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshTarget } from "../server/fresh.ts";

test("a workspace route syncs that workspace; ?workspace= names one too", () => {
  assert.deepEqual(freshTarget("/api/workspaces/desk", null), { workspace: "desk" });
  assert.deepEqual(freshTarget("/api/workspaces/desk/agents/builder/run", null), { workspace: "desk" });
  assert.deepEqual(freshTarget("/api/workspaces/p%2D1/source", null), { workspace: "p-1" });
  assert.deepEqual(freshTarget("/api/secrets", "desk"), { workspace: "desk" }, "PUT /api/secrets?workspace= right after a create");
});

test("the list and create route syncs the account; the shelf's routes sync @library", () => {
  assert.deepEqual(freshTarget("/api/workspaces", null), { account: true });
  assert.deepEqual(freshTarget("/api/library/skills", null), { workspace: "@library" });
  assert.deepEqual(freshTarget("/api/account/agents-md", null), { workspace: "@library" });
});

test("nothing for routes that hold no workspace files", () => {
  assert.equal(freshTarget("/api/keys", null), null);
  assert.equal(freshTarget("/api/me/inbox", null), null);
  assert.equal(freshTarget("/api/usage", null), null);
});
