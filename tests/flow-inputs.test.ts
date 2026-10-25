// "Run with…": the input sets a flow card offers, and the file "Save current
// as input set" writes. The file is read back through core's own eval
// parser here, so the dashboard's writer cannot drift from what `foldrun
// check`, the evals route and `foldrun invoke --inputs` read.
//
//   node --import ./tests/register.mjs --test tests/flow-inputs.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { inputSetsFor, inputsFile, upsertInputSet, layoutTask, cleanSetName } from "../components/flow-inputs-model.ts";
import { parseEval } from "../../foldrun-core/src/evals.ts";

test("a new file is an inputs: true eval for the flow, with the set as its one case", () => {
  const text = upsertInputSet(null, "publish", "rain gauges", "Write about cleaning a rain gauge.");
  const e = parseEval("publish-inputs.md", text);
  assert.equal(e.flow, "publish");
  assert.equal(e.inputs, true);
  assert.equal(e.trigger, "manual");
  assert.deepEqual(e.cases.map((c) => [c.name, c.task, c.expect.length]), [["rain gauges", "Write about cleaning a rain gauge.", 0]]);
  assert.equal(inputsFile("publish"), "evals/publish-inputs.md");
});

test("adding keeps every other set and the prose; saving a taken name replaces only that set", () => {
  let text = upsertInputSet(null, "publish", "one", "first task");
  text = upsertInputSet(text, "publish", "two", "second task");
  text = upsertInputSet(text, "publish", "three", "third task");
  text = upsertInputSet(text, "publish", "two", "second, revised\n- a bullet\n\nand a paragraph");
  const e = parseEval("publish-inputs.md", text);
  assert.deepEqual(e.cases.map((c) => c.name), ["one", "two", "three"]);
  // A `- ` line is written `* ` (it would end the block); a blank line
  // between paragraphs is folded away by the parser, as for any eval.
  assert.equal(e.cases[1].task, "second, revised\n* a bullet\nand a paragraph");
  assert.equal(e.cases[2].task, "third task");
  assert.match(text, /Not an eval: nothing here is asserted\./);
});

test("tasks that a bare line would mangle go in a block", () => {
  assert.equal(layoutTask("plain"), "task: plain");
  assert.match(layoutTask('"quoted"'), /^task: \|\n {2}"quoted"$/);
  for (const t of ['"quoted"', "two\nlines", "| pipe first"]) {
    const e = parseEval("x.md", `---\nflow: f\ninputs: true\n---\n## s\n${layoutTask(t)}\n`);
    assert.equal(e.cases[0].task, t);
  }
});

test("names are one heading line", () => {
  assert.equal(cleanSetName("  ## case: weekly\n run "), "weekly run");
  assert.throws(() => upsertInputSet(null, "f", "  ", "t"), /needs a name/);
  assert.throws(() => upsertInputSet(null, "f", "n", " "), /needs a task/);
});

test("the card lists the inputs file first, then eval cases for the flow; a name the inputs file has wins", () => {
  const sets = inputSetsFor(
    [
      { name: "q", file: "publish-quality.md", flow: "publish", cases: [{ name: "rain", task: "eval task" }, { name: "price", task: "quote the RG-40" }, { name: "empty", task: "" }] },
      { name: "publish-inputs", file: "publish-inputs.md", flow: "publish", inputs: true, cases: [{ name: "rain", task: "saved task" }] },
      { name: "other", file: "other.md", flow: "other", cases: [{ name: "x", task: "y" }] },
    ],
    "publish",
  );
  assert.deepEqual(sets.map((s) => [s.name, s.task, s.source]), [
    ["rain", "saved task", "inputs"],
    ["price", "quote the RG-40", "eval"],
  ]);
});
