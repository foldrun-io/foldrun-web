import { test } from "node:test";
import assert from "node:assert/strict";
import { testableHere } from "../server/tool-test-scope.ts";

const k8s = { FOLDRUN_SEARCH_PER_ACCOUNT: "1", FOLDRUN_RUN_ISOLATION: "k8s" };

test("search on a per-account install is sent to a test run, with the command", () => {
  const r = testableHere("web", k8s);
  assert.ok(r);
  assert.equal(r.ok, false);
  assert.match(r.detail, /foldrun invoke .* --test/);
});

test("every other tool, and search on an install with a shared engine, is tested here", () => {
  assert.equal(testableHere("browser", k8s), null);
  assert.equal(testableHere("web_search", k8s), null, "the retired name is not ours");
  assert.equal(testableHere("websearch", k8s), null, "nor the older one");
  assert.equal(testableHere("web", { FOLDRUN_RUN_ISOLATION: "k8s" }), null);
  assert.equal(testableHere("web", { FOLDRUN_SEARCH_PER_ACCOUNT: "1" }), null);
});
