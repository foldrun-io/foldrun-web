// Long card lists collapse through one component, and its state helper
// survives storage that is missing or throws.
//
//   node --test tests/collapse.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  collapseKey,
  readStored,
  writeStored,
  resolveOpen,
  hashTargets,
  anchorId,
  type CollapseStorage,
} from "../components/collapse-model.ts";

const fake = (): CollapseStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const throwing: CollapseStorage = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

test("one key per page and item", () => {
  assert.equal(collapseKey("flows:sales", "digest"), "foldrun.collapse.flows:sales.digest");
  assert.notEqual(collapseKey("flows:a", "x"), collapseKey("flows:b", "x"));
});

test("a written choice reads back; nothing written reads as null", () => {
  const s = fake();
  const k = collapseKey("flows:w", "f");
  assert.equal(readStored(s, k), null);
  assert.equal(writeStored(s, k, true), true);
  assert.equal(readStored(s, k), true);
  writeStored(s, k, false);
  assert.equal(readStored(s, k), false);
});

test("storage that is missing or throws never throws, and reads as no choice", () => {
  assert.equal(readStored(null, "k"), null);
  assert.equal(readStored(undefined, "k"), null);
  assert.equal(readStored(throwing, "k"), null);
  assert.equal(writeStored(null, "k", true), false);
  assert.equal(writeStored(throwing, "k", true), false);
});

test("a stored value that is not ours is ignored", () => {
  const s = fake();
  s.data.set("k", "yes");
  assert.equal(readStored(s, "k"), null);
});

test("collapsed by default; the page may say otherwise", () => {
  assert.equal(resolveOpen({}), false);
  assert.equal(resolveOpen({ defaultOpen: true }), true);
});

test("the viewer's stored choice beats the default", () => {
  assert.equal(resolveOpen({ stored: true }), true);
  assert.equal(resolveOpen({ stored: false, defaultOpen: true }), false);
});

test("a search match or #anchor opens it over a stored 'closed'; a click beats both", () => {
  assert.equal(resolveOpen({ stored: false, forced: true }), true);
  assert.equal(resolveOpen({ manual: false, forced: true, stored: true }), false);
  assert.equal(resolveOpen({ manual: true, stored: false }), true);
});

test("the hash names a card by its id", () => {
  assert.equal(hashTargets("#flow-digest", "flow-digest"), true);
  assert.equal(hashTargets("#flow-other", "flow-digest"), false);
  assert.equal(hashTargets("", "flow-digest"), false);
  assert.equal(hashTargets("#flow-%E0%A4%A", "flow-x"), false); // malformed escape does not throw
});

test("anchor ids are safe in a URL", () => {
  assert.equal(anchorId("flow", "Weekly Digest!"), "flow-weekly-digest");
  assert.equal(anchorId("desk", "seo_desk"), "desk-seo_desk");
});

// Consistency: the pages that list long stacks of cards use the one
// component, not a hand-rolled chevron and a useState each.
const read = (rel: string) => fs.readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");

test("the Flows page collapses each flow with CollapsibleCard and offers Expand all", () => {
  const src = read("app/dashboard/[workspace]/flows/page.tsx");
  assert.match(src, /from "@\/components\/collapsible-card"/);
  assert.match(src, /<CollapsibleCard\b/);
  assert.match(src, /<CollapseAll\b/);
  // The canvas is inside the card body, so it does not mount while collapsed.
  const card = src.indexOf("<CollapsibleCard");
  assert.ok(card !== -1 && src.indexOf("<FlowCanvas", card) > card, "FlowCanvas must sit inside the CollapsibleCard");
  assert.ok(src.indexOf("</CollapsibleCard>") > src.indexOf("<FlowCanvas"), "FlowCanvas must sit inside the CollapsibleCard");
});

test("every converted list uses the shared component", () => {
  for (const f of [
    "app/dashboard/[workspace]/evals/eval-card.tsx",
    "app/dashboard/usage/page.tsx",
    "components/file-browser.tsx",
  ]) {
    assert.match(read(f), /<CollapsibleCard\b/, `${f} should use CollapsibleCard`);
  }
});
