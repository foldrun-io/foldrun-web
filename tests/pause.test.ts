// The kill switch's read (server/pause.ts): what holds runs, and a caller
// scoped to some workspaces is told nothing of the others.
//
//   node --import ./tests/register.mjs --test tests/pause.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-pause-"));
process.env.FOLDRUN_DATA = root;
for (const ws of ["desk", "secret-desk"]) fs.mkdirSync(path.join(root, "acme", "workspaces", ws), { recursive: true });
const { setPaused } = await import("../../foldrun-platform/src/admin.ts");
const { pauseView } = await import("../server/pause.ts");

test("a scoped caller sees only its own paused workspaces; the account's pause applies everywhere", async () => {
  await setPaused("acme", "desk", { pause: { by: "ana@acme.io" } });
  await setPaused("acme", "secret-desk", { pause: { by: "cto@acme.io", reason: "acquisition talks" } });
  assert.deepEqual(Object.keys((await pauseView("acme", null, ["desk"])).workspaces ?? {}), ["desk"]);
  assert.deepEqual(Object.keys((await pauseView("acme", null, null)).workspaces ?? {}).sort(), ["desk", "secret-desk"]);
  assert.equal((await pauseView("acme", "desk")).paused?.scope, "workspace");
  await setPaused("acme", null, { pause: { by: "owner" } });
  assert.equal((await pauseView("acme", "desk")).paused?.scope, "account", "the wider pause is named first");
});
