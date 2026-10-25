// The step options panel's limits: rows, checked against the keys core reads,
// written as the one-line block parseFlow reads back — and the node's chip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlow, updateFlowStep } from "../../foldrun-core/src/store.ts";
import { limitRows, limitProblems, limitKeyProblem, limitsText, limitsChip } from "../components/step-limits-model.ts";
import { stepChips } from "../components/flow-canvas-model.ts";

test("keys: web.<action>, web, calls, or a tool the agent is granted", () => {
  const granted = ["web", "crm", "desk-email"];
  assert.equal(limitKeyProblem("web.search", granted), null);
  assert.equal(limitKeyProblem("web.monitor", granted), null);
  assert.equal(limitKeyProblem("web", granted), null);
  assert.equal(limitKeyProblem("calls", granted), null);
  assert.equal(limitKeyProblem("crm", granted), null);
  assert.equal(limitKeyProblem("desk_email", granted), null, "dashes and underscores are one tool");
  assert.match(limitKeyProblem("web.serch", granted)!, /dotted keys are web\.search/);
  assert.match(limitKeyProblem("slack", granted)!, /not one of this agent's tools/);
  assert.match(limitKeyProblem("", granted)!, /a key/);
});

test("counts are whole numbers, 1 or more; duplicates and half-filled rows are refused; empty rows ignored", () => {
  const p = limitProblems(
    [
      { key: "web.search", count: "10" },
      { key: "calls", count: "0" },
      { key: "crm", count: "2.5" },
      { key: "web.search", count: "3" },
      { key: "", count: "" },
    ],
    ["crm"],
  );
  assert.deepEqual(p, ["calls: a whole number of calls, 1 or more", "crm: a whole number of calls, 1 or more", "web.search is set twice"]);
  assert.deepEqual(limitProblems([{ key: "web.search", count: "10" }], []), []);
});

test("written through updateFlowStep, read back by parseFlow as the same limits", () => {
  const flow = "---\nname: f\n---\n\n1. [[researcher]] — find it\n";
  const rows = [{ key: "web.search", count: "10" }, { key: "calls", count: " 300 " }, { key: "", count: "" }];
  const text = limitsText(rows)!;
  assert.equal(text, "{web.search: 10, calls: 300}");
  const out = updateFlowStep(flow, 0, { limits: text });
  const step = parseFlow("f.md", out).steps[0];
  assert.deepEqual(step.limits, { "web.search": 10, calls: 300 });
  assert.deepEqual(limitRows(step.limits), [{ key: "web.search", count: "10" }, { key: "calls", count: "300" }]);
  assert.equal(limitsText([]), null, "no rows clears the option");
  // The node shows it.
  assert.ok(stepChips(step).some((c) => c.label === "limits: web.search 10, calls 300"));
  assert.equal(limitsChip({ a: 1, b: 2, c: 3 }), "limits: a 1, b 2 +1");
  assert.equal(limitsChip(undefined), null);
});

test("with the agent's tools unknown, any tool-shaped name passes and check judges it", () => {
  assert.equal(limitKeyProblem("crm", null), null);
  assert.match(limitKeyProblem("not a key", null)!, /not a key/);
  assert.match(limitKeyProblem("web.nope", null)!, /dotted keys/);
});
