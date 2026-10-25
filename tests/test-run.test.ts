// The Test run panel's model: effects are read off the record, counted,
// and said in one line — pinned here so the panel cannot drift from what
// the runner and the proxy actually write.

import test from "node:test";
import assert from "node:assert/strict";
import { testEffects, testEffectSummary } from "../components/test-run-model.ts";
import type { RunRecord } from "../../foldrun-core/src/store.ts";

const run = {
  steps: [
    {
      agent: "researcher",
      events: [
        { t: "1", type: "info", text: "egress: GET api.dataforseo.com/v3 → 200 (12ms)" },
        { t: "2", type: "info", text: "test: RESEND_API_KEY withheld", effect: { kind: "withheld", summary: "RESEND_API_KEY withheld from the sandbox" } },
      ],
    },
    {
      agent: "sender",
      events: [
        { t: "3", type: "info", text: "test: POST api.twilio.com/… refused", effect: { kind: "refused", host: "api.twilio.com", method: "POST", path: "/2010-04-01/Accounts/x/Messages.json", summary: "To=+61…" } },
        { t: "4", type: "info", text: "test: POST api.resend.com/emails redirected", effect: { kind: "redirected", host: "api.resend.com", method: "POST", path: "/emails", summary: "would have gone to a@b" } },
        { t: "5", type: "info", text: "test: would have written state/sends.md, +3 lines", effect: { kind: "diverted", path: "state/sends.md", summary: "would have written state/sends.md, +3 lines" } },
      ],
    },
  ],
} as unknown as RunRecord;

test("effects are listed in step order with their step and agent", () => {
  const rows = testEffects(run);
  assert.deepEqual(rows.map((r) => [r.step, r.agent, r.kind]), [
    [1, "researcher", "withheld"],
    [2, "sender", "refused"],
    [2, "sender", "redirected"],
    [2, "sender", "diverted"],
  ]);
  assert.equal(rows[1].host, "api.twilio.com");
});

test("the summary counts each kind and says nothing about kinds that did not happen", () => {
  assert.equal(testEffectSummary(testEffects(run)), "1 send refused · 1 email redirected · 1 file diverted · 1 secret withheld");
  assert.equal(testEffectSummary([]), "nothing outward was attempted");
  assert.equal(
    testEffectSummary([{ kind: "refused", summary: "" }, { kind: "refused", summary: "" }]),
    "2 sends refused",
  );
});

test("a live run has no effects — the panel has nothing to show", () => {
  assert.deepEqual(testEffects({ steps: [{ agent: "a", events: [{ t: "1", type: "info", text: "x" }] }] } as unknown as RunRecord), []);
});
