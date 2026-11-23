// Read-your-writes (server/fresh.ts): what a request brings level with the
// heads before it is answered (14 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshTarget } from "../server/fresh.ts";

test("a workspace route syncs that workspace; ?workspace= names one too", () => {
  assert.deepEqual(freshTarget("/v1/workspaces/desk", null), { workspace: "desk" });
  assert.deepEqual(freshTarget("/v1/workspaces/desk/agents/builder/run", null), { workspace: "desk" });
  assert.deepEqual(freshTarget("/v1/workspaces/p%2D1/source", null), { workspace: "p-1" });
  assert.deepEqual(freshTarget("/v1/secrets", "desk"), { workspace: "desk" }, "PUT /v1/secrets?workspace= right after a create");
});

test("the list and create route syncs the account; the shelf's routes sync @library", () => {
  assert.deepEqual(freshTarget("/v1/workspaces", null), { account: true });
  assert.deepEqual(freshTarget("/v1/library/skills", null), { workspace: "@library" });
  assert.deepEqual(freshTarget("/v1/account/agents-md", null), { workspace: "@library" });
});

test("nothing for routes that hold no workspace files", () => {
  assert.equal(freshTarget("/v1/keys", null), null);
  assert.equal(freshTarget("/v1/me/inbox", null), null);
  assert.equal(freshTarget("/v1/account/usage", null), null);
});
