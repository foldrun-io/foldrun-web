// A viewer is refused a recorded call's input/output (workspace:write on the
// calls route). The trace says so in a sentence instead of drawing a control
// that ends in a bare "403"; the server's refusal stays the only gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callContentError, callContentNeeds } from "../components/trace-model.ts";

test("a refused read (403) reads as who may see call content, never a raw status", () => {
  assert.equal(callContentError(403, "your role cannot do this"), callContentNeeds());
  assert.match(callContentNeeds(), /editors and above/);
});

test("the other failures keep their words", () => {
  assert.equal(callContentError(502, "x"), "captured call unavailable");
  assert.equal(callContentError(404, "no recorded content"), "no recorded content");
  assert.equal(callContentError(500, undefined), "500");
});
