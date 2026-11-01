// The dashboard's A2A pieces, pure (1 Nov 2026): the flow PATCH's `a2a`
// merge, the publish form's body, the curl it shows, and the "A2A · <key>"
// label on runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { a2aBodyOf, a2aCurl, a2aFormOf, a2aKeyLabels, a2aPatch, a2aRunLabel, a2aStateWord } from "../components/a2a-model.ts";

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
  assert.deepEqual(form, { publish: true, name: "", description: "D", examples: "one\ntwo", publicCard: false });
  assert.deepEqual(a2aFormOf(null), { publish: false, name: "", description: "", examples: "", publicCard: false });
  const body = a2aBodyOf({ ...form, examples: " one \n\n three ", publicCard: true });
  assert.deepEqual(body, { publish: true, name: null, description: "D", examples: ["one", "three"], public_card: true });
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
