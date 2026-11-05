// The dashboard's A2A pieces, pure (1 Nov 2026): the flow PATCH's `a2a`
// merge, the publish form's body, the curl it shows, and the "A2A · <key>"
// label on runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { a2aBodyOf, a2aCurl, a2aFormOf, a2aKeyLabels, a2aPatch, a2aRiskState, a2aRunLabel, a2aStateWord } from "../components/a2a-model.ts";

test("a2aPatch: a key sent replaces, null removes, the rest is kept", () => {
  const current = { publish: true, name: "Lead finder", description: "Finds leads.", examples: ["a"], input: { type: "object" } };
  assert.deepEqual(a2aPatch({ publish: false }, current), { value: { ...current, publish: false } });
  assert.deepEqual(a2aPatch({ name: null, examples: [] }, current), { value: { publish: true, description: "Finds leads.", input: { type: "object" } } });
  assert.deepEqual(a2aPatch({ name: "  Spaced  " }, current), { value: { ...current, name: "Spaced" } });
  assert.deepEqual(a2aPatch(null, current), { value: null });
});

test("a2aPatch: a fresh block without publish is a draft; a block that would not read is refused", () => {
  assert.deepEqual(a2aPatch({ name: "x" }, undefined), { value: { name: "x", publish: false } });
  assert.ok("error" in a2aPatch({ publish: "yes" }, undefined));
  assert.ok("error" in a2aPatch({ publsh: true }, undefined));
  assert.ok("error" in a2aPatch(["publish"], undefined));
  assert.ok("error" in a2aPatch({ publish: true, examples: "not a list" }, undefined));
  assert.ok("error" in a2aPatch({ publish: true, name: "x".repeat(101) }, undefined));
});

test("the form reads the parsed block and writes every key it owns, never input", () => {
  const form = a2aFormOf({ publish: true, name: null, description: "D", examples: ["one", "two"], publicCard: false });
  assert.deepEqual(form, { publish: true, name: "", description: "D", examples: "one\ntwo", publicCard: false, acceptRisk: [] });
  assert.deepEqual(a2aFormOf(null), { publish: false, name: "", description: "", examples: "", publicCard: false, acceptRisk: [] });
  const body = a2aBodyOf({ ...form, examples: " one \n\n three ", publicCard: true });
  assert.deepEqual(body, { publish: true, name: null, description: "D", examples: ["one", "three"], public_card: true, accept_risk: null });
  assert.ok(!("input" in body), "the input schema is not the form's; the merge keeps it");
  assert.equal(a2aBodyOf({ ...form, publicCard: false }).public_card, null);
});

test("the curl: JSON-RPC SendMessage, A2A-Version 1.0, the key from the environment, quoted for a shell", () => {
  const c = a2aCurl("https://app.example.test/a2a/acme/desk/flows/leads", { text: "it's leads" });
  assert.match(c, /^curl -sS 'https:\/\/app\.example\.test\/a2a\/acme\/desk\/flows\/leads'/);
  assert.match(c, /authorization: Bearer \$FOLDRUN_A2A_KEY/);
  assert.match(c, /A2A-Version: 1\.0/);
  const json = c.split("-d ")[1]!.slice(1, -1).replace(/'\\''/g, "'");
  const body = JSON.parse(json) as { method: string; params: { message: { parts: { text: string }[]; role: string } } };
  assert.equal(body.method, "SendMessage");
  assert.equal(body.params.message.role, "ROLE_USER");
  assert.equal(body.params.message.parts[0]!.text, "it's leads");
  assert.match(a2aCurl("https://x.test/a2a/a/b/flows/c", { keyEnv: "PARTNER_KEY" }), /\$PARTNER_KEY/);
});

test("a run an outside agent started reads A2A · <key label>; every other run, nothing", () => {
  const labels = a2aKeyLabels([
    { id: "k1", label: "partner", purpose: "a2a", a2a: { principal: "k1" } },
    { id: "k2", label: "partner (rotated)", purpose: "a2a", a2a: { principal: "k1" } },
    { id: "k3", label: "old", purpose: "a2a", revokedAt: "2026-10-01T00:00:00Z", a2a: { principal: "k3" } },
    { id: "k4", label: "cli", role: "editor" } as never,
  ]);
  assert.equal(labels.k1, "partner (rotated)");
  assert.equal(labels.k3, "old", "a revoked key still names the runs it started");
  assert.equal(labels.k4, undefined);
  assert.equal(a2aRunLabel({ trigger: "a2a", a2a: { key: "k1" } }, labels), "A2A · partner (rotated)");
  assert.equal(a2aRunLabel({ trigger: "a2a", a2a: { key: "gone" } }, labels), "A2A · an outside agent");
  assert.equal(a2aRunLabel({}, labels), null);
  assert.equal(a2aStateWord("TASK_STATE_INPUT_REQUIRED"), "input required");
});

// FOL-112: the form owns accept_risk — the agents an admin accepts holding a
// secret while they can run code — and says when saving would be refused.
test("accept_risk: the form reads, writes and merges it; the risk state says what blocks a publish", () => {
  const form = a2aFormOf({ publish: true, name: null, description: null, examples: [], publicCard: false, acceptRisk: ["worker"] });
  assert.deepEqual(form.acceptRisk, ["worker"]);
  assert.deepEqual(a2aBodyOf(form).accept_risk, ["worker"]);
  const merged = a2aPatch({ accept_risk: ["worker"] }, { publish: true, name: "N" });
  assert.deepEqual(merged, { value: { publish: true, name: "N", accept_risk: ["worker"] } });
  assert.deepEqual(a2aPatch({ accept_risk: [] }, { publish: true, accept_risk: ["worker"] }), { value: { publish: true } }, "an empty list removes it");
  assert.ok("error" in a2aPatch({ publish: true, accept_risk: "worker" }, undefined), "a list of names, as core reads it");
  const risks = [{ flow: "leads", agent: "worker", secrets: ["T"], accepted: false }, { flow: "other", agent: "x", secrets: ["U"], accepted: false }];
  assert.deepEqual(a2aRiskState("leads", risks, { publish: true, acceptRisk: [] }), { items: [{ agent: "worker", secrets: ["T"], accepted: false }], blocks: true });
  assert.equal(a2aRiskState("leads", risks, { publish: true, acceptRisk: ["worker"] }).blocks, false);
  assert.equal(a2aRiskState("leads", risks, { publish: false, acceptRisk: [] }).blocks, false, "not published: nothing to refuse");
});
