// The create dialog opens what it made: a new workspace lands on its own
// dashboard instead of leaving the switcher stale until a reload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createdHref } from "../components/create-model.ts";

test("a created workspace opens its dashboard, tenant kept", () => {
  assert.equal(createdHref({ ok: true, name: "test", dashboard: "/dashboard/test?tenant=matt" }), "/dashboard/test?tenant=matt");
});

test("no dashboard in the answer, or one off-site, stays put", () => {
  assert.equal(createdHref({ ok: true }), null);
  assert.equal(createdHref(null), null);
  assert.equal(createdHref({ dashboard: "https://evil.example/dashboard/x" }), null);
  assert.equal(createdHref({ dashboard: "//evil.example" }), null);
});
