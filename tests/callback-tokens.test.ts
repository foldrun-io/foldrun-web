// The open callbacks — a flow's hook, its inbox, a run's event URL — share
// one token compare and one wrong-token limit (server/limits.ts), and a
// signed hook is verified on the body it was sent, not a cut of it.
// 30 Oct 2026.
//
//   node --import ./tests/register.mjs --test tests/callback-tokens.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-callback-tokens-"));
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
delete process.env.FOLDRUN_REDIS_URL;
const { NextRequest } = await import("next/server");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const hooks = (await import("../app/api/hooks/[tenant]/[workspace]/[flow]/route.ts")) as unknown as { POST: Handler };
const inbox = (await import("../app/api/inbox/[tenant]/[workspace]/[flow]/route.ts")) as unknown as { POST: Handler };
const events = (await import("../app/api/events/[tenant]/[workspace]/[runId]/route.ts")) as unknown as { POST: Handler };
const { sameToken } = await import("../server/limits.ts");
const { webhookToken, readDeliveries } = await import("../../foldrun-core/src/webhook.ts");
const { setSecret } = await import("../../foldrun-core/src/secrets.ts");

const ws = path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
fs.mkdirSync(path.join(ws, "agents/intake"), { recursive: true });
fs.writeFileSync(path.join(ws, "agents/intake/agent.md"), "---\nname: intake\n---\n\nRead it.\n");
fs.writeFileSync(
  path.join(ws, "flows/signed.md"),
  "---\ntrigger: webhook\nsignature: hmac\nsigning_secret: ${HOOK_SIG}\n---\n\n1. [[intake]] — Read the delivery.\n",
);
setSecret("acme", "HOOK_SIG", "whsec-callback-test", "desk");

// 32 characters, 64 bytes: the same string length as a real token.
const NON_ASCII = "é".repeat(32);

const post = (
  mod: { POST: Handler },
  url: string,
  params: Record<string, string>,
  init: { body?: string; headers?: Record<string, string> } = {},
) =>
  mod.POST(
    new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...init.headers }, body: init.body ?? "{}" }),
    { params: Promise.resolve(params) },
  );

test("sameToken compares bytes, so a token of the right length in characters but not in bytes is a plain no", () => {
  assert.equal(sameToken("abc", "abc"), true);
  assert.equal(sameToken("abd", "abc"), false);
  assert.equal(sameToken("", "abc"), false);
  assert.equal(sameToken(null, "abc"), false);
  assert.equal(sameToken("abc", ""), false, "an empty expected value never matches");
  assert.doesNotThrow(() => sameToken(NON_ASCII, "x".repeat(32)));
  assert.equal(sameToken(NON_ASCII, "x".repeat(32)), false);
});

test("a non-ASCII token is a 401 on every callback, never a 500", async () => {
  const q = `?token=${encodeURIComponent(NON_ASCII)}`;
  const params = { tenant: "acme", workspace: "desk", flow: "signed" };
  assert.equal((await post(hooks, `http://x/api/hooks/acme/desk/signed${q}`, params)).status, 401);
  assert.equal((await post(inbox, `http://x/api/inbox/acme/desk/signed${q}`, params)).status, 401);
  assert.equal(
    (await post(events, `http://x/api/events/acme/desk/run-x${q}`, { tenant: "acme", workspace: "desk", runId: "run-x" })).status,
    401,
  );
});

test("an event URL's wrong tokens are throttled per caller, like a hook's", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const hit = (ip: string, token: string) =>
      post(events, `http://x/api/events/acme/desk/run-y?token=${encodeURIComponent(token)}`, { tenant: "acme", workspace: "desk", runId: "run-y" }, {
        headers: { "x-forwarded-for": ip },
      });
    const statuses: number[] = [];
    for (let i = 0; i < 33; i++) statuses.push((await hit("203.0.113.77", i % 2 ? "wrong" : NON_ASCII)).status);
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(401));
    assert.ok(statuses.slice(30).every((s) => s === 429), `after 30: ${statuses.slice(30)}`);
    assert.equal((await hit("198.51.100.8", "wrong")).status, 401, "another caller is unaffected");
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("a signed delivery over 20,000 characters is verified on the whole body", async () => {
  const token = webhookToken("acme", "desk", "signed");
  const params = { tenant: "acme", workspace: "desk", flow: "signed" };
  const body = JSON.stringify({ action: "push", padding: "x".repeat(50_000) });
  const sign = (b: string) => crypto.createHmac("sha256", "whsec-callback-test").update(b).digest("hex");

  // Signed over the whole body: past the signature, whatever the run start says.
  await post(hooks, `http://x/api/hooks/acme/desk/signed?token=${token}`, params, { body, headers: { "x-signature": sign(body) } });
  assert.notEqual(readDeliveries("acme", "desk", 1)[0]?.outcome, "invalid-signature", "the full body's signature holds");

  // Signed over only the first 20,000 characters — what the route used to
  // check — is not the sender's signature, and is refused.
  const res = await post(hooks, `http://x/api/hooks/acme/desk/signed?token=${token}`, params, {
    body,
    headers: { "x-signature": sign(body.slice(0, 20_000)) },
  });
  assert.equal(res.status, 401);
  assert.equal(readDeliveries("acme", "desk", 1)[0]?.outcome, "invalid-signature");
});
