// The plan's workspace count (server/workspace-cap.ts), 14 Nov 2026: Pro and
// Scale have no count, and used to be capped at the install-wide default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceCap } from "../server/workspace-cap.ts";

test("a named plan with no workspace count has no limit (Pro, Scale)", () => {
  assert.equal(workspaceCap({ name: "pro", concurrency: 4 } as { name: string }, 3), null);
  assert.equal(workspaceCap({ name: "scale" }, 3), null);
});

test("a plan's own count wins; no plan, or levers with no plan name, take the default", () => {
  assert.equal(workspaceCap({ name: "starter", workspaces: 3 }, 10), 3);
  assert.equal(workspaceCap({ name: "creator", workspaces: 10 }, 3), 10);
  assert.equal(workspaceCap(null, 3), 3);
  assert.equal(workspaceCap({ workspaces: undefined } as { workspaces?: number }, 3), 3);
});

test("no default set (0 or unset) is no limit", () => {
  assert.equal(workspaceCap(null, 0), null);
  assert.equal(workspaceCap(null, Number.NaN), null);
});
